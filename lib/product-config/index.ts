export type {
  CompanyFormProductRow,
  CompanyProductConfigMode,
  CompanyProductResolveResult,
  NormalizedProductDefinition,
  ProductConfigSource,
  ProductConfiguration,
} from "./types.ts";

export { listSelectableBaseForms, getBaseFormDefinition, isKnownBaseFormId } from "./base-forms.ts";
export { resolveCompanyProductsFromRegistry } from "./registry-adapter.ts";
export {
  areAdditionalProductsAllowed,
  filterSelectableProducts,
  getAllowedAdditionalProducts,
  getAllowedPrimaryProducts,
  normalizeDatabaseProductRow,
  resolveCompanyProducts,
  sortProducts,
} from "./resolve-company-products.ts";
export {
  fetchAllCompanyFormProductCounts,
  fetchCompanyFormProducts,
  insertCompanyFormProduct,
  setCompanyFormProductActive,
  updateCompanyFormProduct,
  type UpsertCompanyFormProductInput,
} from "./repository.ts";
export {
  clearProductLabelOverlay,
  getOverlayBaseFormId,
  getOverlayProductLabel,
  setProductLabelOverlay,
} from "./label-overlay.ts";
export {
  parseProductConfiguration,
  pairingFieldsFromConfiguration,
  mergeProductConfiguration,
  type ProductConfigurationRecord,
} from "./configuration.ts";
export {
  buildProductLookupMaps,
  toProductDisplayContext,
  findNormalizedProduct,
  resolveEffectiveSectionKeyWithLookup,
  getProductLabelWithLookup,
  formatSectionKeysAsLabelsWithLookup,
  selectedSectionsIncludeEffectiveWithLookup,
  toFormDefinitionFromProduct,
  type ProductLookupMaps,
  type ProductDisplayContext,
} from "./product-lookup.ts";
export {
  baseFormSupportsMultipleInstances,
  canonicalBaseFormIdForProduct,
  selectedProductsViolateSingleInstanceBase,
  findSingleInstancePairingConfigWarnings,
} from "./pairing-guardrails.ts";
