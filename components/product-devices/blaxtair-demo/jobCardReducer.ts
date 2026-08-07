/**
 * Pure reducer over the full BlaxtairDemoJobCard — kept framework-light and unit-testable
 * without React. See lib/prototype/blaxtair-job-card.ts for the data shape.
 */
import type { InstalledProductSystem } from "@/lib/product-devices";
import {
  type BlaxtairDemoJobCard,
  type BlaxtairInstallationDetails,
  type BlaxtairJobCardPhoto,
  type BlaxtairJobSiteInfo,
  type BlaxtairVehicleInfo,
  type ConnectionDetail,
  type JobCardStage,
} from "@/lib/prototype/blaxtair-job-card";

export type JobCardAction =
  | { type: "LOAD"; card: BlaxtairDemoJobCard }
  | { type: "SET_STAGE"; stage: JobCardStage }
  | { type: "SET_JOB_SITE_FIELD"; field: keyof BlaxtairJobSiteInfo; value: string }
  | { type: "SET_VEHICLE_FIELD"; field: keyof BlaxtairVehicleInfo; value: string }
  | { type: "SET_CONNECTION"; connection: "power" | "ground" | "ignition"; patch: Partial<ConnectionDetail> }
  | {
      type: "SET_INSTALLATION_FIELD";
      field: Exclude<keyof BlaxtairInstallationDetails, "power" | "ground" | "ignition">;
      value: string;
    }
  | { type: "SET_EQUIPMENT"; equipment: InstalledProductSystem | null }
  | { type: "ADD_PHOTO"; photo: BlaxtairJobCardPhoto }
  | { type: "UPDATE_PHOTO"; id: string; patch: Partial<BlaxtairJobCardPhoto> }
  | { type: "REMOVE_PHOTO"; id: string }
  | { type: "SET_NOTES"; value: string };

export function jobCardReducer(state: BlaxtairDemoJobCard, action: JobCardAction): BlaxtairDemoJobCard {
  const now = new Date().toISOString();
  switch (action.type) {
    case "LOAD":
      return action.card;
    case "SET_STAGE":
      return { ...state, currentStage: action.stage, updatedAt: now };
    case "SET_JOB_SITE_FIELD":
      return { ...state, jobSite: { ...state.jobSite, [action.field]: action.value }, updatedAt: now };
    case "SET_VEHICLE_FIELD":
      return { ...state, vehicle: { ...state.vehicle, [action.field]: action.value }, updatedAt: now };
    case "SET_CONNECTION":
      return {
        ...state,
        installation: {
          ...state.installation,
          [action.connection]: { ...state.installation[action.connection], ...action.patch },
        },
        updatedAt: now,
      };
    case "SET_INSTALLATION_FIELD":
      return {
        ...state,
        installation: { ...state.installation, [action.field]: action.value },
        updatedAt: now,
      };
    case "SET_EQUIPMENT":
      return { ...state, equipment: action.equipment, updatedAt: now };
    case "ADD_PHOTO":
      return { ...state, photos: [...state.photos, action.photo], updatedAt: now };
    case "UPDATE_PHOTO":
      return {
        ...state,
        photos: state.photos.map((p) => (p.id === action.id ? { ...p, ...action.patch } : p)),
        updatedAt: now,
      };
    case "REMOVE_PHOTO":
      return { ...state, photos: state.photos.filter((p) => p.id !== action.id), updatedAt: now };
    case "SET_NOTES":
      return { ...state, technicianNotes: action.value, updatedAt: now };
    default:
      return state;
  }
}
