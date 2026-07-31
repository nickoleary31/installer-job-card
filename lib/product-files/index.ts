export type {
  ProductFileCategory,
  ProductFileDefinition,
  UploadedProductFile,
  ProductFileUploadSlot,
} from "./types.ts";
export {
  PPD_JSON_FILE_KEY,
  PPD_PRODUCT_KEY,
  productFileSlotId,
  readUploadedProductFiles,
  mergeDurableProductFiles,
  extractProductFilesFromPayload,
} from "./types.ts";
export {
  ppdJsonFileDefinition,
  ppdProductFileConfiguration,
  isExactSharedPpdProduct,
  EXAMPLE_PRODUCT_FILE_DEFINITIONS,
  parseProductFileDefinition,
  parseProductFileDefinitions,
  activeProductFileDefinitions,
  resolveProductFileDefinitionsForProduct,
} from "./definitions.ts";
export {
  validateProductFile,
  slotHasProductFile,
  collectRequiredProductFileIssues,
  flattenUploadedProductFiles,
  type ProductFileValidationIssue,
} from "./validation.ts";
export {
  uploadedProductFileFromPpdJsonConfig,
  ppdJsonConfigFromUploadedProductFile,
  findPpdJsonProductFile,
  hydrateProductFileSlotsFromPayload,
  hydrateAllProductFileSlotsFromPayload,
  syncPpdPayloadWithProductFiles,
  mergeLegacyPpdIntoProductFiles,
} from "./ppd-bridge.ts";
export {
  buildProductFileStoragePath,
  uploadProductFile,
  insertProductFileSiteRowTyped,
} from "./storage.ts";
