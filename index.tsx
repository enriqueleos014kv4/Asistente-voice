/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * This is the main entry point for the application.
 * It sets up the LitElement-based MapApp component, initializes the Google GenAI
 * client for chat interactions, and establishes communication between the
 * Model Context Protocol (MCP) client and server. The MCP server exposes
 * map-related tools that the AI model can use, and the client relays these
 * tool calls to the server.
 */

import {GoogleGenAI, mcpToTool} from '@google/genai';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {ChatState, MapApp, marked} from './map_app'; // Updated import path

import {startMcpGoogleMapServer} from './mcp_maps_server';

/* --------- */

async function startClient(transport: Transport) {
  const client = new Client({name: 'AI Studio', version: '1.0.0'});
  await client.connect(transport);
  return client;
}

/* ------------ */

const SYSTEM_INSTRUCTION_BASE = `You are a friendly and helpful virtual assistant for "LLANTERA MÓVIL COFRADÍA".

Here is the business information you MUST use when asked:
- Business Name: LLANTERA MÓVIL COFRADÍA
- Service: 24-hour mobile tire service at the customer's location (servicio a domicilio).
- Service Area: Mazamitla, Jalisco and surrounding areas (y alrededores).
- Phone Number: 3334854080
- Email: llanteramovilcofradia@gmail.com
- Website: www.llanterasmovilesmazamitla.com

Your primary goal is to assist users who have tire problems by collecting their information and scheduling a service. You are also empowered to answer questions about the company and its services.

You will be provided with an inventory list of products and services. You MUST use this list to answer any user questions about prices, availability, or service times.

When a user wants to schedule a service, you must follow these steps in a conversational manner, asking for one piece of information at a time if the user doesn't provide it all at once:
1. Greet the user warmly and confirm they need tire service.
2. Ask for the user's name.
3. Once you have their name, ask for their phone number.
4. Once you have their phone number, ask for details about the service they need (e.g., "llanta ponchada," "cambio de llanta," "revisión de aire").
5. After getting the details, you MUST ask the user to click on the map to pinpoint the exact location where they need the service. Use a clear and direct instruction, for example: "Great. Now, please click on the map to show me exactly where you are."
6. The user will click the map, and their address will be sent to you automatically. Once you receive the address, you MUST use the 'view_location_google_maps' tool to confirm the location on the map. Use the full address provided for the 'query' parameter.
7. After successfully calling the tool, you MUST provide a service confirmation block for internal data capture. This block is for internal use and should not be displayed to the user. It MUST look exactly like this:
<service_confirmation>
Name: [User's Name]
Phone: [User's Phone Number]
Details: [Service Details]
Address: [User's Address]
</service_confirmation>
8. Immediately after the block, confirm with the user using a friendly message like: "Thank you, [User's Name]. I've scheduled a service for [Service Details] at [User's Address]. Help is on the way."

General Conversation Rules:
- If the user asks a general question, answer it helpfully using the provided business and inventory information.
- If the conversation strays, but you sense they still need help, gently guide them back by asking if they're ready to schedule their tire service.
- Always maintain a friendly and professional tone in Spanish.
- Do not ask for all the information at once. Proceed step-by-step for service requests.
- If the 'view_location_google_maps' tool gives an error, you MUST inform the user and ask them to provide a more specific address. For example: "Lo siento, no pude localizar esa dirección. ¿Podrías proporcionarla de nuevo, incluyendo la ciudad y el estado?"`;

const ai = new GoogleGenAI({
  apiKey: process.env.API_KEY,
});

function camelCaseToDash(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

document.addEventListener('DOMContentLoaded', async (event) => {
  const rootElement = document.querySelector('#root')! as HTMLElement;

  const mapApp = new MapApp();
  rootElement.appendChild(mapApp);

  const [transportA, transportB] = InMemoryTransport.createLinkedPair();

  void startMcpGoogleMapServer(
    transportA,
    (params: {location?: string; origin?: string; destination?: string}) => {
      mapApp.handleMapQuery(params);
    },
  );

  const mcpClient = await startClient(transportB);

  mapApp.sendMessageHandler = async (input: string, role: string) => {
    const {thinkingElement, textElement, thinkingContainer} = mapApp.addMessage(
      'assistant',
      '',
    );

    mapApp.setChatState(ChatState.GENERATING);
    textElement.innerHTML = '...'; // Initial placeholder

    let newCode = '';
    let thoughtAccumulator = '';

    try {
      // Get inventory and build dynamic system instructions
      const inventory = mapApp.getInventory();
      const inventoryString =
        inventory.length > 0
          ? inventory
              .map(
                (item) =>
                  `- ${item.name} (${item.type}): ${
                    item.price ? `$${item.price}` : 'Consultar'
                  }. ${item.description || ''}`,
              )
              .join('\n')
          : 'No hay productos o servicios en el inventario en este momento.';

      const currentSystemInstruction =
        SYSTEM_INSTRUCTION_BASE +
        '\n\nINVENTARIO ACTUAL:\n' +
        inventoryString;

      // Reconstruct history from DOM elements
      const chatHistory = mapApp.messages
        .filter((el) => !el.classList.contains('role-error'))
        .map((el) => {
          const textContent =
            el.querySelector('.text')?.textContent?.trim() || '';
          if (el.classList.contains('role-user')) {
            return {role: 'user', parts: [{text: textContent}]};
          } else {
            return {role: 'model', parts: [{text: textContent}]};
          }
        });

      // Create a new chat session with updated context for each message
      const aiChat = ai.chats.create({
        model: 'gemini-2.5-flash',
        config: {
          systemInstruction: currentSystemInstruction,
          tools: [mcpToTool(mcpClient)],
        },
        history: chatHistory.slice(0, -1), // History up to the last message
      });

      // Inner try for AI interaction and message parsing
      const stream = await aiChat.sendMessageStream({message: input});

      for await (const chunk of stream) {
        for (const candidate of chunk.candidates ?? []) {
          for (const part of candidate.content?.parts ?? []) {
            if (part.functionCall) {
              console.log(
                'FUNCTION CALL:',
                part.functionCall.name,
                part.functionCall.args,
              );
              const mcpCall = {
                name: camelCaseToDash(part.functionCall.name!),
                arguments: part.functionCall.args,
              };

              const explanation =
                'Calling function:\n```json\n' +
                JSON.stringify(mcpCall, null, 2) +
                '\n```';
              const {textElement: functionCallText} = mapApp.addMessage(
                'assistant',
                '',
              );
              functionCallText.innerHTML = await marked.parse(explanation);
            }

            if (part.thought) {
              mapApp.setChatState(ChatState.THINKING);
              thoughtAccumulator += ' ' + part.thought;
              thinkingElement.innerHTML = await marked.parse(thoughtAccumulator);
              if (thinkingContainer) {
                thinkingContainer.classList.remove('hidden');
                thinkingContainer.setAttribute('open', 'true');
              }
            } else if (part.text) {
              mapApp.setChatState(ChatState.EXECUTING);
              newCode += part.text;
              const userVisibleText = newCode.replace(
                /<service_confirmation>[\s\S]*?<\/service_confirmation>/,
                '',
              );
              textElement.innerHTML = await marked.parse(userVisibleText);
            }
            mapApp.scrollToTheEnd();
          }
        }
      }

      // After stream is done, speak the final message and check for map interactions.
      const finalUserVisibleText = newCode
        .replace(/<service_confirmation>[\s\S]*?<\/service_confirmation>/, '')
        .trim();

      if (finalUserVisibleText) {
        mapApp.speakMessage(finalUserVisibleText);
      }

      if (
        newCode.toLowerCase().includes('click on the map') ||
        newCode.toLowerCase().includes('clic en el mapa')
      ) {
        mapApp.enableLocationSelectionMode();
      }

      // Post-processing logic
      const confirmationRegex =
        /<service_confirmation>([\s\S]*?)<\/service_confirmation>/;
      const match = newCode.match(confirmationRegex);

      if (match && match[1]) {
        const detailsText = match[1];
        const nameMatch = detailsText.match(/Name:\s*(.*)/);
        const phoneMatch = detailsText.match(/Phone:\s*(.*)/);
        const detailsMatch = detailsText.match(/Details:\s*(.*)/);
        const addressMatch = detailsText.match(/Address:\s*(.*)/);

        const name = nameMatch ? nameMatch[1].trim() : null;
        const phone = phoneMatch ? phoneMatch[1].trim() : null;
        const details = detailsMatch ? detailsMatch[1].trim() : null;
        const address = addressMatch ? addressMatch[1].trim() : null;

        if (name && address && phone) {
          mapApp.addServiceToHistory({
            name,
            address,
            phone,
            details: details || 'No especificado',
          });
        }
      }

      if (thinkingContainer && thinkingContainer.hasAttribute('open')) {
        if (!thoughtAccumulator) {
          thinkingContainer.classList.add('hidden');
        }
        thinkingContainer.removeAttribute('open');
      }

      if (
        textElement.innerHTML.trim() === '...' ||
        textElement.innerHTML.trim().length === 0
      ) {
        const hasFunctionCallMessage = mapApp.messages.some((el) =>
          el.innerHTML.includes('Calling function:'),
        );
        if (!hasFunctionCallMessage) {
          textElement.innerHTML = await marked.parse('Done.');
        } else if (textElement.innerHTML.trim() === '...') {
          textElement.innerHTML = '';
        }
      }
    } catch (e: unknown) {
      console.error('GenAI SDK Error:', e);
      let errorMessage: string;
      if (e instanceof Error) {
        errorMessage = e.message;
      } else {
        errorMessage = String(e);
      }
      const {textElement: errorTextElement} = mapApp.addMessage('error', '');
      errorTextElement.innerHTML = await marked.parse(
        `Error: ${errorMessage}`,
      );
    } finally {
      mapApp.setChatState(ChatState.IDLE);
    }
  };

  const triggerInitialGreeting = async () => {
    if (mapApp.messages.length > 0) return;
    // Use sendMessageAction to ensure the full context (inventory) is used.
    await mapApp.sendMessageAction(
      'Por favor, preséntate cordialmente como el asistente de LLANTERA MÓVIL COFRADÍA y saluda al usuario para iniciar la conversación.',
      'system',
    );
  };

  triggerInitialGreeting();
});
