/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * This file defines the main `gdm-map-app` LitElement component.
 * This component is responsible for:
 * - Rendering the user interface, including the Google Photorealistic 3D Map,
 *   chat messages area, and user input field.
 * - Managing the state of the chat (e.g., idle, generating, thinking).
 * - Handling user input and sending messages to the Gemini AI model.
 * - Processing responses from the AI, including displaying text and handling
 *   function calls (tool usage) related to map interactions.
 * - Integrating with the Google Maps JavaScript API to load and control the map,
 *   display markers, polylines for routes, and geocode locations.
 * - Providing the `handleMapQuery` method, which is called by the MCP server
 *   (via index.tsx) to update the map based on AI tool invocations.
 */

// Google Maps JS API Loader: Used to load the Google Maps JavaScript API.
import {Loader} from '@googlemaps/js-api-loader';
import hljs from 'highlight.js';
import {html, LitElement, PropertyValueMap} from 'lit';
import {customElement, query, state} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';
import {Marked} from 'marked';
import {markedHighlight} from 'marked-highlight';

import {MapParams} from './mcp_maps_server';

// Make SpeechRecognition types available.
declare global {
  interface SpeechRecognitionResult {
    readonly isFinal: boolean;
    readonly length: number;
    item(index: number): SpeechRecognitionAlternative;
    [index: number]: SpeechRecognitionAlternative;
  }

  interface SpeechRecognitionResultList {
    readonly length: number;
    item(index: number): SpeechRecognitionResult;
    [index: number]: SpeechRecognitionResult;
  }

  interface SpeechRecognitionAlternative {
    readonly transcript: string;
    readonly confidence: number;
  }

  interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    lang: string;
    interimResults: boolean;
    onstart: (() => void) | null;
    onresult: ((event: SpeechRecognitionEvent) => void) | null;
    onend: (() => void) | null;
    onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
    start(): void;
    stop(): void;
  }

  const SpeechRecognition: {
    new (): SpeechRecognition;
  };

  const webkitSpeechRecognition: {
    new (): SpeechRecognition;
  };

  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof webkitSpeechRecognition;
  }
  interface SpeechRecognitionEvent extends Event {
    results: SpeechRecognitionResultList;
    resultIndex: number;
  }
  interface SpeechRecognitionErrorEvent extends Event {
    error: string;
  }
}

/** Markdown formatting function with syntax hilighting */
export const marked = new Marked(
  markedHighlight({
    async: true,
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    highlight(code, lang, info) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, {language}).value;
    },
  }),
);

const ICON_BUSY = html`<svg
  class="rotating"
  xmlns="http://www.w3.org/2000/svg"
  height="24px"
  viewBox="0 -960 960 960"
  width="24px"
  fill="currentColor">
  <path
    d="M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-155.5t86-127Q252-817 325-848.5T480-880q17 0 28.5 11.5T520-840q0 17-11.5 28.5T480-800q-133 0-226.5 93.5T160-480q0 133 93.5 226.5T480-160q133 0 226.5-93.5T800-480q0-17 11.5-28.5T840-520q17 0 28.5 11.5T880-480q0 82-31.5 155t-86 127.5q-54.5 54.5-127 86T480-80Z" />
</svg>`;

const ICON_SPEAKER_ON = html`<svg
  xmlns="http://www.w3.org/2000/svg"
  height="24px"
  viewBox="0 0 24 24"
  width="24px"
  fill="currentColor">
  <path d="M0 0h24v24H0z" fill="none" />
  <path
    d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
</svg>`;

const ICON_SPEAKER_OFF = html`<svg
  xmlns="http://www.w3.org/2000/svg"
  height="24px"
  viewBox="0 0 24 24"
  width="24px"
  fill="currentColor">
  <path d="M0 0h24v24H0z" fill="none" />
  <path
    d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
</svg>`;

const ICON_MIC = html`<svg
  xmlns="http://www.w3.org/2000/svg"
  height="24px"
  viewBox="0 0 24 24"
  width="24px"
  fill="currentColor">
  <path d="M0 0h24v24H0z" fill="none" />
  <path
    d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z" />
</svg>`;

/**
 * Chat state enum to manage the current state of the chat interface.
 */
export enum ChatState {
  IDLE,
  GENERATING,
  THINKING,
  EXECUTING,
}

/**
 * Chat tab enum to manage the current selected tab in the chat interface.
 */
enum ChatTab {
  GEMINI,
}

/**
 * Chat role enum to manage the current role of the message.
 */
export enum ChatRole {
  USER,
  ASSISTANT,
  SYSTEM,
}

// Google Maps API Key: Replace with your actual Google Maps API key.
// This key is essential for loading and using Google Maps services.
// Ensure this key is configured with access to the "Maps JavaScript API",
// "Geocoding API", and the "Directions API".
const USER_PROVIDED_GOOGLE_MAPS_API_KEY: string =
  'AIzaSyAJPTwj4S8isr4b-3NtqVSxk450IAS1lOQ'; // <-- REPLACE THIS WITH YOUR ACTUAL API KEY

type ServiceStatus = 'Pendiente' | 'Aprobado' | 'En Proceso' | 'Terminado';

interface ServiceHistoryItem {
  id: string;
  name: string;
  phone: string;
  address: string;
  details?: string;
  timestamp: Date;
  status: ServiceStatus;
  price: string | null;
}

interface InventoryItem {
  id: string;
  name: string;
  type: 'Producto' | 'Servicio';
  price: string;
  description: string;
}

/**
 * MapApp component for Photorealistic 3D Maps.
 */
@customElement('gdm-map-app')
export class MapApp extends LitElement {
  @query('#anchor') anchor?: HTMLDivElement;
  // Google Maps: Reference to the <gmp-map-3d> DOM element where the map is rendered.
  @query('#mapContainer') mapContainerElement?: HTMLElement; // Will be <gmp-map-3d>
  @query('#messageInput') messageInputElement?: HTMLInputElement;
  @query('#inventory-form') inventoryFormElement?: HTMLFormElement;

  @state() chatState = ChatState.IDLE;
  @state() isRunning = true;
  @state() selectedChatTab = ChatTab.GEMINI;
  @state() inputMessage = '';
  @state() messages: HTMLElement[] = [];
  @state() mapInitialized = false;
  @state() mapError = '';
  @state() currentView: 'chat' | 'admin' = 'chat';
  @state() serviceHistory: ServiceHistoryItem[] = [];
  @state() isLocationSelectionMode = false;
  @state() locationSelectionMessage = '';
  @state() isMuted = false;
  @state() isListening = false;
  @state() currentAdminTab: 'history' | 'inventory' = 'history';
  @state() inventory: InventoryItem[] = [];
  @state() editingInventoryItem: InventoryItem | null = null;

  // Google Maps: Instance of the Google Maps 3D map.
  private map?: any;
  // Google Maps: Instance of the Google Maps Geocoding service.
  private geocoder?: any;
  // Google Maps: Instance of the current map marker (Marker3DElement).
  private marker?: any;
  // Google Maps: Marker for user's selection click.
  private selectionMarker?: any;

  // Google Maps: References to 3D map element constructors.
  private Map3DElement?: any;
  private Marker3DElement?: any;
  private Polyline3DElement?: any;

  // Google Maps: Instance of the Google Maps Directions service.
  private directionsService?: any;
  // Google Maps: Instance of the current route polyline.
  private routePolyline?: any;
  // Google Maps: Markers for origin and destination of a route.
  private originMarker?: any;
  private destinationMarker?: any;

  // Speech synthesis and recognition
  private recognition?: SpeechRecognition;
  private voices: SpeechSynthesisVoice[] = [];

  sendMessageHandler?: CallableFunction;

  constructor() {
    super();
  }

  createRenderRoot() {
    return this;
  }

  protected firstUpdated(
    _changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>,
  ): void {
    // Google Maps: Load the map when the component is first updated.
    this.loadMap();
    this.initializeSpeechRecognition();
    this.initializeSpeechSynthesis();
    this._loadInventory();
  }

  private initializeSpeechSynthesis() {
    if ('speechSynthesis' in window) {
      // Load voices asynchronously
      const loadVoices = () => {
        this.voices = window.speechSynthesis.getVoices();
      };
      loadVoices();
      window.speechSynthesis.onvoiceschanged = loadVoices;
    } else {
      console.warn('Speech Synthesis API not supported in this browser.');
    }
  }

  private initializeSpeechRecognition() {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = false;
      this.recognition.lang = 'es-MX';
      this.recognition.interimResults = true;

      this.recognition.onstart = () => {
        this.isListening = true;
      };

      this.recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interimTranscript = '';
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }
        this.inputMessage = finalTranscript + interimTranscript;
      };

      this.recognition.onend = () => {
        this.isListening = false;
      };

      this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.error('Speech recognition error', event.error);
        this.isListening = false;
      };
    } else {
      console.warn('Speech Recognition API not supported in this browser.');
    }
  }

  /**
   * Google Maps: Loads the Google Maps JavaScript API using the JS API Loader.
   * It initializes necessary map services like Geocoding and Directions,
   * and imports 3D map elements (Map3DElement, Marker3DElement, Polyline3DElement).
   * Handles API key validation and error reporting.
   */
  async loadMap() {
    if (
      USER_PROVIDED_GOOGLE_MAPS_API_KEY.startsWith('YOUR_') ||
      !USER_PROVIDED_GOOGLE_MAPS_API_KEY
    ) {
      this.mapError = `Google Maps API Key is not configured correctly.
Please edit the map_app.ts file and replace the placeholder value for
USER_PROVIDED_GOOGLE_MAPS_API_KEY with your actual API key.
You can find this constant near the top of the map_app.ts file.`;
      console.error(this.mapError);
      this.requestUpdate();
      return;
    }

    const loader = new Loader({
      apiKey: USER_PROVIDED_GOOGLE_MAPS_API_KEY,
      version: 'beta', // Using 'beta' for Photorealistic 3D Maps features
      libraries: ['geocoding', 'routes', 'geometry'], // Request necessary libraries
    });

    try {
      await loader.load();
      // Google Maps: Import 3D map specific library elements.
      const maps3dLibrary = await (window as any).google.maps.importLibrary(
        'maps3d',
      );
      this.Map3DElement = maps3dLibrary.Map3DElement;
      this.Marker3DElement = maps3dLibrary.Marker3DElement;
      this.Polyline3DElement = maps3dLibrary.Polyline3DElement;

      if ((window as any).google && (window as any).google.maps) {
        // Google Maps: Initialize the DirectionsService.
        this.directionsService = new (
          window as any
        ).google.maps.DirectionsService();
      } else {
        console.error('DirectionsService not loaded.');
      }

      // Google Maps: Initialize the map itself.
      this.initializeMap();
      this.mapInitialized = true;
      this.mapError = '';
    } catch (error) {
      console.error('Error loading Google Maps API:', error);
      this.mapError =
        'Could not load Google Maps. Check console for details and ensure API key is correct. If using 3D features, ensure any necessary Map ID is correctly configured if required programmatically.';
      this.mapInitialized = false;
    }
    this.requestUpdate();
  }

  /**
   * Google Maps: Initializes the map instance and the Geocoder service.
   * This is called after the Google Maps API has been successfully loaded.
   */
  initializeMap() {
    if (!this.mapContainerElement || !this.Map3DElement) {
      console.error('Map container or Map3DElement class not ready.');
      return;
    }
    // Google Maps: Assign the <gmp-map-3d> element to the map property.
    this.map = this.mapContainerElement;
    if ((window as any).google && (window as any).google.maps) {
      // Google Maps: Initialize the Geocoder.
      this.geocoder = new (window as any).google.maps.Geocoder();
    } else {
      console.error('Geocoder not loaded.');
    }
    // Add click listener for location selection
    this.map.addEventListener('click', this._handleMapClick.bind(this));
  }

  setChatState(state: ChatState) {
    this.chatState = state;
  }

  /**
   * Google Maps: Clears existing map elements like markers and polylines
   * before adding new ones. This ensures the map doesn't get cluttered with
   * old search results or routes.
   */
  private _clearMapElements() {
    if (this.marker) {
      this.marker.remove();
      this.marker = undefined;
    }
    if (this.routePolyline) {
      this.routePolyline.remove();
      this.routePolyline = undefined;
    }
    if (this.originMarker) {
      this.originMarker.remove();
      this.originMarker = undefined;
    }
    if (this.destinationMarker) {
      this.destinationMarker.remove();
      this.destinationMarker = undefined;
    }
    if (this.selectionMarker) {
      this.selectionMarker.remove();
      this.selectionMarker = undefined;
    }
  }

  /**
   * Google Maps: Handles viewing a specific location on the map.
   * It uses the Geocoding service to find coordinates for the `locationQuery`,
   * then flies the camera to that location and places a 3D marker.
   * @param locationQuery The string query for the location (e.g., "Eiffel Tower").
   */
  private async _handleViewLocation(locationQuery: string) {
    if (
      !this.mapInitialized ||
      !this.map ||
      !this.geocoder ||
      !this.Marker3DElement
    ) {
      if (!this.mapError) {
        const {textElement} = this.addMessage('error', 'Processing error...');
        textElement.innerHTML = await marked.parse(
          'Map is not ready to display locations. Please check configuration.',
        );
      }
      console.warn(
        'Map not initialized, geocoder or Marker3DElement not available, cannot render query.',
      );
      return;
    }
    this._clearMapElements(); // Google Maps: Clear previous elements.

    // Google Maps: Use Geocoding service to find the location.
    this.geocoder.geocode(
      {
        address: locationQuery,
        componentRestrictions: {
          country: 'MX',
        },
      },
      async (results: any, status: string) => {
        if (status === 'OK' && results && results[0] && this.map) {
          const location = results[0].geometry.location;

          // Google Maps: Define camera options and fly to the location.
          const cameraOptions = {
            center: {lat: location.lat(), lng: location.lng(), altitude: 0},
            heading: 0,
            tilt: 67.5,
            range: 2000, // Distance from the target in meters
          };
          (this.map as any).flyCameraTo({
            endCamera: cameraOptions,
            durationMillis: 1500,
          });

          // Google Maps: Create and add a 3D marker to the map.
          this.marker = new this.Marker3DElement();
          this.marker.position = {
            lat: location.lat(),
            lng: location.lng(),
            altitude: 0,
          };
          const label =
            locationQuery.length > 30
              ? locationQuery.substring(0, 27) + '...'
              : locationQuery;
          this.marker.label = label;
          (this.map as any).appendChild(this.marker);
        } else {
          console.error(
            `Geocode was not successful for "${locationQuery}". Reason: ${status}`,
          );
          const rawErrorMessage = `No pude encontrar la dirección: "${locationQuery}". Por favor, asegúrate de que sea una dirección completa y vuelve a intentarlo. (Error: ${status})`;
          const {textElement} = this.addMessage('error', 'Processing error...');
          textElement.innerHTML = await marked.parse(rawErrorMessage);
        }
      },
    );
  }

  /**
   * Google Maps: Handles displaying directions between an origin and destination.
   * It uses the DirectionsService to calculate the route, then draws a 3D polyline
   * for the route and places 3D markers at the origin and destination.
   * The camera is adjusted to fit the entire route.
   * @param originQuery The starting point for directions.
   * @param destinationQuery The ending point for directions.
   */
  private async _handleDirections(
    originQuery: string,
    destinationQuery: string,
  ) {
    if (
      !this.mapInitialized ||
      !this.map ||
      !this.directionsService ||
      !this.Marker3DElement ||
      !this.Polyline3DElement
    ) {
      if (!this.mapError) {
        const {textElement} = this.addMessage('error', 'Processing error...');
        textElement.innerHTML = await marked.parse(
          'Map is not ready for directions. Please check configuration.',
        );
      }
      console.warn(
        'Map not initialized or DirectionsService/3D elements not available, cannot render directions.',
      );
      return;
    }
    this._clearMapElements(); // Google Maps: Clear previous elements.

    // Google Maps: Use DirectionsService to get the route.
    this.directionsService.route(
      {
        origin: originQuery,
        destination: destinationQuery,
        travelMode: (window as any).google.maps.TravelMode.DRIVING,
      },
      async (response: any, status: string) => {
        if (
          status === 'OK' &&
          response &&
          response.routes &&
          response.routes.length > 0
        ) {
          const route = response.routes[0];

          // Google Maps: Draw the route polyline using Polyline3DElement.
          if (route.overview_path && this.Polyline3DElement) {
            const pathCoordinates = route.overview_path.map((p: any) => ({
              lat: p.lat(),
              lng: p.lng(),
              altitude: 5,
            })); // Add slight altitude
            this.routePolyline = new this.Polyline3DElement();
            this.routePolyline.coordinates = pathCoordinates;
            this.routePolyline.strokeColor = 'blue';
            this.routePolyline.strokeWidth = 10;
            (this.map as any).appendChild(this.routePolyline);
          }

          // Google Maps: Add marker for the origin.
          if (
            route.legs &&
            route.legs[0] &&
            route.legs[0].start_location &&
            this.Marker3DElement
          ) {
            const originLocation = route.legs[0].start_location;
            this.originMarker = new this.Marker3DElement();
            this.originMarker.position = {
              lat: originLocation.lat(),
              lng: originLocation.lng(),
              altitude: 0,
            };
            this.originMarker.label = 'Origin';
            this.originMarker.style = {
              color: {r: 0, g: 128, b: 0, a: 1}, // Green
            };
            (this.map as any).appendChild(this.originMarker);
          }

          // Google Maps: Add marker for the destination.
          if (
            route.legs &&
            route.legs[0] &&
            route.legs[0].end_location &&
            this.Marker3DElement
          ) {
            const destinationLocation = route.legs[0].end_location;
            this.destinationMarker = new this.Marker3DElement();
            this.destinationMarker.position = {
              lat: destinationLocation.lat(),
              lng: destinationLocation.lng(),
              altitude: 0,
            };
            this.destinationMarker.label = 'Destination';
            this.destinationMarker.style = {
              color: {r: 255, g: 0, b: 0, a: 1}, // Red
            };
            (this.map as any).appendChild(this.destinationMarker);
          }

          // Google Maps: Adjust camera to fit the route bounds.
          if (route.bounds) {
            const bounds = route.bounds;
            const center = bounds.getCenter();
            let range = 10000; // Default range

            // Calculate a more appropriate range based on the route's diagonal distance
            if (
              (window as any).google.maps.geometry &&
              (window as any).google.maps.geometry.spherical
            ) {
              const spherical = (window as any).google.maps.geometry.spherical;
              const ne = bounds.getNorthEast();
              const sw = bounds.getSouthWest();
              const diagonalDistance = spherical.computeDistanceBetween(ne, sw);
              range = diagonalDistance * 1.7; // Multiplier to ensure bounds are visible
            } else {
              console.warn(
                'google.maps.geometry.spherical not available for range calculation. Using fallback range.',
              );
            }

            range = Math.max(range, 2000); // Ensure a minimum sensible range

            const cameraOptions = {
              center: {lat: center.lat(), lng: center.lng(), altitude: 0},
              heading: 0,
              tilt: 45, // Tilt for better 3D perspective of the route
              range: range,
            };
            (this.map as any).flyCameraTo({
              endCamera: cameraOptions,
              durationMillis: 2000,
            });
          }
        } else {
          console.error(
            `Directions request failed. Origin: "${originQuery}", Destination: "${destinationQuery}". Status: ${status}. Response:`,
            response,
          );
          const rawErrorMessage = `Could not get directions from "${originQuery}" to "${destinationQuery}". Reason: ${status}`;
          const {textElement} = this.addMessage('error', 'Processing error...');
          textElement.innerHTML = await marked.parse(rawErrorMessage);
        }
      },
    );
  }

  /**
   * Google Maps: This function is the primary interface for the MCP server (via index.tsx)
   * to trigger updates on the Google Map. When the AI model uses a map-related tool
   * (e.g., view location, get directions), the MCP server processes this request
   * and calls this function with the appropriate parameters.
   *
   * Based on the `params` received, this function will:
   * - If `params.location` is present, call `_handleViewLocation` to show a specific place.
   * - If `params.origin` and `params.destination` are present, call `_handleDirections`
   *   to display a route.
   * - If only `params.destination` is present (as a fallback), it will treat it as a location to view.
   *
   * This mechanism allows the AI's tool usage to be directly reflected on the map UI.
   * @param params An object containing parameters for the map query, like
   *               `location`, `origin`, or `destination`.
   */
  async handleMapQuery(params: MapParams) {
    if (params.location) {
      this._handleViewLocation(params.location);
    } else if (params.origin && params.destination) {
      this._handleDirections(params.origin, params.destination);
    } else if (params.destination) {
      // Fallback if only destination is provided, treat as viewing a location
      this._handleViewLocation(params.destination);
    }
  }

  setInputField(message: string) {
    this.inputMessage = message.trim();
  }

  addMessage(role: string, message: string) {
    const div = document.createElement('div');
    div.classList.add('turn');
    div.classList.add(`role-${role.trim()}`);
    div.setAttribute('aria-live', 'polite');

    const thinkingDetails = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Thinking process';
    thinkingDetails.classList.add('thinking');
    thinkingDetails.setAttribute('aria-label', 'Model thinking process');
    const thinkingElement = document.createElement('div');
    thinkingDetails.append(summary);
    thinkingDetails.append(thinkingElement);
    div.append(thinkingDetails);

    const textElement = document.createElement('div');
    textElement.className = 'text';
    textElement.innerHTML = message;
    div.append(textElement);

    this.messages = [...this.messages, div];
    this.scrollToTheEnd();
    return {
      thinkingContainer: thinkingDetails,
      thinkingElement: thinkingElement,
      textElement: textElement,
    };
  }

  public addServiceToHistory(details: {
    name: string;
    phone: string;
    address: string;
    details: string;
  }) {
    const newService: ServiceHistoryItem = {
      id: `${new Date().getTime()}-${Math.random().toString(36).slice(2)}`,
      ...details,
      timestamp: new Date(),
      status: 'Pendiente',
      price: null,
    };
    this.serviceHistory = [newService, ...this.serviceHistory];
    console.log('Service request added to history:', newService);
  }

  scrollToTheEnd() {
    if (!this.anchor) return;
    this.anchor.scrollIntoView({
      behavior: 'smooth',
      block: 'end',
    });
  }

  async sendMessageAction(message?: string, role?: string) {
    if (this.chatState !== ChatState.IDLE) return;
    window.speechSynthesis.cancel();

    if (this.isLocationSelectionMode && !message) {
      this.disableLocationSelectionMode();
    }

    let msg = '';
    const msgRole = role ? role.toLowerCase() : 'user';

    if (message) {
      msg = message.trim();
    } else {
      msg = this.inputMessage.trim();
      if (msg.toLowerCase() === 'soy administrador') {
        this.currentView = 'admin';
        this.currentAdminTab =
          'history'; // Default to history tab when opening admin
        this.inputMessage = '';
        return;
      }
      if (msg.length > 0) {
        this.inputMessage = '';
      }
    }

    if (msg.length === 0) {
      return;
    }

    // Add user's or system message to the chat display
    if (msgRole === 'user' || (msgRole === 'system' && msg)) {
      const {textElement} = this.addMessage(
        msgRole === 'system' ? 'assistant' : msgRole,
        '...',
      );
      textElement.innerHTML = await marked.parse(msg);
    }

    if (this.sendMessageHandler) {
      await this.sendMessageHandler(
        msg,
        msgRole === 'system' ? 'user' : msgRole,
      );
    }
  }

  private _handleApprove(serviceId: string) {
    const item = this.serviceHistory.find((s) => s.id === serviceId);
    if (!item) return;

    this.serviceHistory = this.serviceHistory.map((service) =>
      service.id === serviceId ? {...service, status: 'Aprobado'} : service,
    );
    alert(
      `Notificación enviada al cliente: ${item.name} (${item.phone}).\nSu servicio ha sido aprobado.`,
    );
  }

  private _handleProcess(serviceId: string) {
    const item = this.serviceHistory.find((s) => s.id === serviceId);
    if (!item) return;

    this.serviceHistory = this.serviceHistory.map((service) =>
      service.id === serviceId ? {...service, status: 'En Proceso'} : service,
    );
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
      item.address,
    )}`;
    window.open(mapsUrl, '_blank');
  }

  private _handleFinish(serviceId: string) {
    const item = this.serviceHistory.find((s) => s.id === serviceId);
    if (!item) return;

    const price = prompt(
      'Por favor, introduce el precio final del servicio:',
      '0.00',
    );
    if (price !== null && price.trim() !== '') {
      this.serviceHistory = this.serviceHistory.map((service) =>
        service.id === serviceId
          ? {...service, status: 'Terminado', price: price}
          : service,
      );
    }
  }

  private async inputKeyDownAction(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.sendMessageAction();
    }
  }

  public enableLocationSelectionMode() {
    this.isLocationSelectionMode = true;
    this.locationSelectionMessage =
      'Haga clic en el mapa para establecer su ubicación';
    if (this.selectionMarker) {
      this.selectionMarker.remove();
      this.selectionMarker = undefined;
    }
  }

  public disableLocationSelectionMode() {
    this.isLocationSelectionMode = false;
    this.locationSelectionMessage = '';
  }

  private async _handleMapClick(event: any) {
    if (!this.isLocationSelectionMode) return;
    if (!this.geocoder || !this.Marker3DElement) return;

    this.locationSelectionMessage = 'Confirmando dirección...';

    const latLng = event.detail.latLng;

    if (this.selectionMarker) {
      this.selectionMarker.remove();
    }
    this.selectionMarker = new this.Marker3DElement();
    this.selectionMarker.position = latLng;
    this.selectionMarker.label = 'Tu ubicación';
    this.selectionMarker.style = {
      color: {r: 255, g: 165, b: 0, a: 1}, // Orange
    };
    (this.map as any).appendChild(this.selectionMarker);

    this.geocoder.geocode(
      {location: latLng},
      async (results: any, status: string) => {
        if (status === 'OK' && results && results[0]) {
          const address = results[0].formatted_address;
          this.disableLocationSelectionMode();
          await this.sendMessageAction(address, 'user');
        } else {
          this.locationSelectionMessage = `No se pudo determinar la dirección. Por favor, intente hacer clic de nuevo. (Error: ${status})`;
          console.error('Reverse geocode failed:', status);
          if (this.selectionMarker) {
            this.selectionMarker.remove();
            this.selectionMarker = undefined;
          }
        }
      },
    );
  }

  public speakMessage(text: string) {
    if (this.isMuted || !text || !('speechSynthesis' in window)) return;

    const cleanText = text
      .replace(/<service_confirmation>[\s\S]*?<\/service_confirmation>/, '')
      .trim();

    if (!cleanText) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'es-MX';

    const spanishVoice = this.voices.find(
      (voice) =>
        voice.lang === 'es-MX' ||
        voice.lang === 'es-US' ||
        voice.lang === 'es-ES',
    );
    if (spanishVoice) {
      utterance.voice = spanishVoice;
    }

    window.speechSynthesis.speak(utterance);
  }

  private _toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.isMuted) {
      window.speechSynthesis.cancel();
    }
  }

  private _toggleVoiceInput() {
    if (!this.recognition) return;

    if (this.isListening) {
      this.recognition.stop();
    } else {
      this.inputMessage = '';
      this.recognition.start();
    }
  }

  // Inventory Management Methods
  private _loadInventory() {
    const savedInventory = localStorage.getItem('llantera-inventory');
    if (savedInventory) {
      this.inventory = JSON.parse(savedInventory);
    } else {
      this._addDefaultInventoryIfEmpty();
    }
  }

  private _saveInventory() {
    localStorage.setItem('llantera-inventory', JSON.stringify(this.inventory));
    this.requestUpdate();
  }

  private _addDefaultInventoryIfEmpty() {
    if (this.inventory.length === 0) {
      this.inventory = [
        {
          id: '1',
          name: 'Reparación de Ponchadura',
          type: 'Servicio',
          price: '150',
          description: 'Reparación de llanta ponchada. Tiempo estimado: 20-30 minutos.',
        },
        {
          id: '2',
          name: 'Cambio de Llanta',
          type: 'Servicio',
          price: '100',
          description: 'Montaje de llanta de refacción. Tiempo estimado: 15-25 minutos. No incluye costo de llanta nueva.',
        },
        {
          id: '3',
          name: 'Llanta Nueva - Rin 15',
          type: 'Producto',
          price: '1200',
          description: 'Precio por una llanta nueva de medida estándar para Rin 15. Marcas variadas.',
        },
      ];
      this._saveInventory();
    }
  }

  public getInventory(): InventoryItem[] {
    return this.inventory;
  }

  private _handleInventorySubmit(e: Event) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    const id =
      this.editingInventoryItem?.id ||
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const newItem: InventoryItem = {
      id,
      name: (formData.get('name') as string) || '',
      type: (formData.get('type') as 'Producto' | 'Servicio') || 'Servicio',
      price: (formData.get('price') as string) || '0',
      description: (formData.get('description') as string) || '',
    };

    if (this.editingInventoryItem) {
      this.inventory = this.inventory.map((item) =>
        item.id === this.editingInventoryItem!.id ? newItem : item,
      );
    } else {
      this.inventory = [...this.inventory, newItem];
    }

    this._saveInventory();
    this.editingInventoryItem = null;
    form.reset();
  }

  private _editInventoryItem(itemToEdit: InventoryItem) {
    this.editingInventoryItem = itemToEdit;
    // We need to wait for the next render cycle for the form to be available
    this.updateComplete.then(() => {
      if (this.inventoryFormElement) {
        (this.inventoryFormElement.elements.namedItem('name') as HTMLInputElement).value = itemToEdit.name;
        (this.inventoryFormElement.elements.namedItem('type') as HTMLSelectElement).value = itemToEdit.type;
        (this.inventoryFormElement.elements.namedItem('price') as HTMLInputElement).value = itemToEdit.price;
        (this.inventoryFormElement.elements.namedItem('description') as HTMLTextAreaElement).value = itemToEdit.description;
        this.inventoryFormElement.scrollIntoView({ behavior: 'smooth' });
      }
    });
  }

  private _deleteInventoryItem(itemId: string) {
    if (confirm('¿Estás seguro de que quieres eliminar este artículo?')) {
      this.inventory = this.inventory.filter((item) => item.id !== itemId);
      this._saveInventory();
    }
  }

  private _cancelEdit() {
    this.editingInventoryItem = null;
    if (this.inventoryFormElement) {
       this.inventoryFormElement.reset();
    }
  }

  private renderServiceHistory() {
    return html`
      <div class="admin-tab-content" id="history-content">
        <div class="service-history-list">
          ${this.serviceHistory.length === 0
            ? html`<p class="no-history-message">
                No hay servicios registrados todavía.
              </p>`
            : this.serviceHistory.map(
                (service) => html`
                  <div
                    class="service-record status-${service.status
                      .toLowerCase()
                      .replace(' ', '-')}">
                    <div class="service-details">
                      <p><strong>Nombre:</strong> ${service.name}</p>
                      <p><strong>Teléfono:</strong> ${service.phone}</p>
                      <p><strong>Dirección:</strong> ${service.address}</p>
                      ${service.details
                        ? html`<p>
                            <strong>Detalles:</strong> ${service.details}
                          </p>`
                        : ''}
                      <p>
                        <strong>Fecha:</strong>
                        ${service.timestamp.toLocaleString('es-MX')}
                      </p>
                      ${service.price
                        ? html`<p><strong>Precio:</strong> $${service.price}</p>`
                        : ''}
                    </div>
                    <div class="service-status">
                      <strong>Estado:</strong>
                      <span
                        class="status-tag status-${service.status
                          .toLowerCase()
                          .replace(' ', '-')}"
                        >${service.status}</span
                      >
                    </div>
                    <div class="service-actions">
                      ${service.status === 'Pendiente'
                        ? html` <button
                            class="action-button approve"
                            @click=${() => this._handleApprove(service.id)}>
                            Aprobar
                          </button>`
                        : ''}
                      ${service.status === 'Aprobado'
                        ? html` <button
                            class="action-button process"
                            @click=${() => this._handleProcess(service.id)}>
                            En Proceso
                          </button>`
                        : ''}
                      ${service.status === 'En Proceso'
                        ? html` <button
                            class="action-button finish"
                            @click=${() => this._handleFinish(service.id)}>
                            Terminar
                          </button>`
                        : ''}
                    </div>
                  </div>
                `,
              )}
        </div>
      </div>
    `;
  }

  private renderInventoryManagement() {
    return html`
    <div class="admin-tab-content" id="inventory-content">
      <div class="inventory-form-container">
        <h3>${
          this.editingInventoryItem ? 'Editar' : 'Añadir Nuevo'
        } Artículo</h3>
        <form id="inventory-form" class="inventory-form" @submit=${
          this._handleInventorySubmit
        }>
          <div class="form-group">
            <label for="inv-name">Nombre del Producto/Servicio</label>
            <input type="text" id="inv-name" name="name" required>
          </div>
          <div class="form-group">
            <label for="inv-type">Tipo</label>
            <select id="inv-type" name="type" required>
              <option value="Servicio">Servicio</option>
              <option value="Producto">Producto</option>
            </select>
          </div>
          <div class="form-group">
            <label for="inv-price">Precio (MXN)</label>
            <input type="text" id="inv-price" name="price" required>
          </div>
          <div class="form-group">
            <label for="inv-desc">Descripción (Opcional)</label>
            <textarea id="inv-desc" name="description" placeholder="Ej. Tiempo estimado, detalles, etc."></textarea>
          </div>
          <div class="form-actions">
            ${
              this.editingInventoryItem
                ? html`<button type="button" class="form-button secondary" @click=${this._cancelEdit}>Cancelar</button>`
                : ''
            }
            <button type="submit" class="form-button primary">
              ${this.editingInventoryItem ? 'Guardar Cambios' : 'Añadir al Inventario'}
            </button>
          </div>
        </form>
      </div>
      <div class="inventory-list-container">
        <h3>Inventario Actual</h3>
        <div class="inventory-list">
          ${
            this.inventory.length === 0
              ? html`<p>El inventario está vacío.</p>`
              : this.inventory.map(
                  (item) => html`
            <div class="inventory-item">
              <div class="inventory-item-details">
                <p><strong>${item.name}</strong> ($${item.price})</p>
                <p><small>${item.type}</small></p>
                ${
                  item.description
                    ? html`<p><small>${item.description}</small></p>`
                    : ''
                }
              </div>
              <div class="inventory-item-actions">
                <button @click=${() => this._editInventoryItem(item)}>Editar</button>
                <button class="delete" @click=${() =>
                  this._deleteInventoryItem(item.id)}>Eliminar</button>
              </div>
            </div>
          `,
                )
          }
        </div>
      </div>
    </div>
    `;
  }

  private renderAdminView() {
    return html`
      <div class="admin-view">
        <div class="admin-header">
          <h2 id="admin-heading">Panel de Administrador</h2>
          <button
            class="admin-back-button"
            @click=${() => (this.currentView = 'chat')}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              height="24px"
              viewBox="0 -960 960 960"
              width="24px"
              fill="currentColor">
              <path
                d="m313-440 224 224-57 56-320-320 320-320 57 56-224 224h487v80H313Z" />
            </svg>
            Volver al Chat
          </button>
        </div>
        <div class="admin-tabs" role="tablist" aria-label="Admin Sections">
          <button
            id="history-tab"
            role="tab"
            aria-controls="history-content"
            aria-selected=${this.currentAdminTab === 'history'}
            class="admin-tab ${classMap({
              active: this.currentAdminTab === 'history',
            })}"
            @click=${() => (this.currentAdminTab = 'history')}>
            Historial de Servicios
          </button>
          <button
            id="inventory-tab"
            role="tab"
            aria-controls="inventory-content"
            aria-selected=${this.currentAdminTab === 'inventory'}
            class="admin-tab ${classMap({
              active: this.currentAdminTab === 'inventory',
            })}"
            @click=${() => (this.currentAdminTab = 'inventory')}>
            Inventario
          </button>
        </div>
        ${this.currentAdminTab === 'history'
          ? this.renderServiceHistory()
          : this.renderInventoryManagement()}
      </div>
    `;
  }

  render() {
    const initialCenter = '0,0,100';
    const initialRange = '20000000';
    const initialTilt = '45';
    const initialHeading = '0';

    return html`<div
      class="gdm-map-app ${this.isLocationSelectionMode
        ? 'location-selection-mode'
        : ''}">
      <div
        class="main-container"
        role="application"
        aria-label="Interactive Map Area">
        ${this.locationSelectionMessage
          ? html`<div class="map-overlay-message" role="status">
              ${this.locationSelectionMessage}
            </div>`
          : ''}
        ${this.mapError
          ? html`<div
              class="map-error-message"
              role="alert"
              aria-live="assertive"
              >${this.mapError}</div
            >`
          : ''}
        <gmp-map-3d
          id="mapContainer"
          style="height: 100%; width: 100%;"
          aria-label="Google Photorealistic 3D Map Display"
          mode="hybrid"
          center="${initialCenter}"
          heading="${initialHeading}"
          tilt="${initialTilt}"
          range="${initialRange}"
          internal-usage-attribution-ids="gmp_aistudio_threedmapjsmcp_v0.1_showcase"
          default-ui-disabled="true"
          role="application">
        </gmp-map-3d>
      </div>
      <div
        class="sidebar"
        role="complementary"
        aria-labelledby="${this.currentView === 'chat'
          ? 'chat-heading'
          : 'admin-heading'}">
        ${this.currentView === 'admin'
          ? this.renderAdminView()
          : html`
              <div
                class="selector"
                role="tablist"
                aria-label="Chat providers">
                <button
                  id="geminiTab"
                  role="tab"
                  aria-selected=${this.selectedChatTab === ChatTab.GEMINI}
                  aria-controls="chat-panel"
                  class=${classMap({
                    'selected-tab': this.selectedChatTab === ChatTab.GEMINI,
                  })}
                  @click=${() => {
                    this.selectedChatTab = ChatTab.GEMINI;
                  }}>
                  <span id="chat-heading">Gemini</span>
                </button>
                <button
                  class="voice-toggle"
                  @click=${this._toggleMute}
                  aria-label=${this.isMuted
                    ? 'Unmute assistant'
                    : 'Mute assistant'}
                  title=${this.isMuted
                    ? 'Unmute assistant'
                    : 'Mute assistant'}>
                  ${this.isMuted ? ICON_SPEAKER_OFF : ICON_SPEAKER_ON}
                </button>
              </div>
              <div
                id="chat-panel"
                role="tabpanel"
                aria-labelledby="geminiTab"
                class=${classMap({
                  tabcontent: true,
                  showtab: this.selectedChatTab === ChatTab.GEMINI,
                })}>
                <div
                  class="chat-messages"
                  aria-live="polite"
                  aria-atomic="false">
                  ${this.messages}
                  <div id="anchor"></div>
                </div>
                <div class="footer">
                  <div
                    id="chatStatus"
                    aria-live="assertive"
                    class=${classMap({
                      hidden: this.chatState === ChatState.IDLE,
                    })}>
                    ${this.chatState === ChatState.GENERATING
                      ? html`${ICON_BUSY} Generating...`
                      : html``}
                    ${this.chatState === ChatState.THINKING
                      ? html`${ICON_BUSY} Thinking...`
                      : html``}
                    ${this.chatState === ChatState.EXECUTING
                      ? html`${ICON_BUSY} Executing...`
                      : html``}
                  </div>
                  <div
                    id="inputArea"
                    role="form"
                    aria-labelledby="message-input-label">
                    <label id="message-input-label" class="hidden"
                      >Type your message</label
                    >
                    <input
                      type="text"
                      id="messageInput"
                      .value=${this.inputMessage}
                      @input=${(e: InputEvent) => {
                        this.inputMessage = (
                          e.target as HTMLInputElement
                        ).value;
                      }}
                      @keydown=${(e: KeyboardEvent) => {
                        this.inputKeyDownAction(e);
                      }}
                      placeholder=${this.isListening
                        ? 'Escuchando...'
                        : 'Escribe tu mensaje aquí...'}
                      autocomplete="off"
                      aria-labelledby="message-input-label"
                      aria-describedby="sendButton-desc" />
                    <button
                      id="micButton"
                      class=${classMap({listening: this.isListening})}
                      @click=${this._toggleVoiceInput}
                      ?disabled=${this.chatState !== ChatState.IDLE}
                      aria-label="Use microphone"
                      title="Use microphone">
                      ${ICON_MIC}
                    </button>
                    <button
                      id="sendButton"
                      @click=${() => {
                        this.sendMessageAction();
                      }}
                      aria-label="Send message"
                      aria-describedby="sendButton-desc"
                      ?disabled=${this.chatState !== ChatState.IDLE ||
                      !this.inputMessage.trim()}
                      class=${classMap({
                        disabled:
                          this.chatState !== ChatState.IDLE ||
                          !this.inputMessage.trim(),
                      })}>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        height="30px"
                        viewBox="0 -960 960 960"
                        width="30px"
                        fill="currentColor"
                        aria-hidden="true">
                        <path
                          d="M120-160v-240l320-80-320-80v-240l760 320-760 320Z" />
                      </svg>
                    </button>
                    <p id="sendButton-desc" class="hidden">
                      Sends the typed message to the AI.
                    </p>
                  </div>
                </div>
              </div>
            `}
      </div>
    </div>`;
  }
}
