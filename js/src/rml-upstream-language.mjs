/** Official source-pinned four-language grammar, project and editing APIs.
 * These are upstream implementations, not token-envelope replacements. A
 * translation is semantic only when its upstream result has non-null semantics;
 * consumers must preserve every assumption, obligation and diagnostic it reports.
 */
export {
  BindingRenameError,
  ProgramRepresentation,
  ProgramTransformationError,
  TranslationSupport,
  analyzeProgram,
  constructProgram,
  constructProgramFromFragments,
  decodeProgramTranslation,
  fourLanguageSupport,
  languageSupport,
  readTranslationProvenance,
  translateProgram,
  translationContracts,
} from '#meta-language';

export const META_LANGUAGE_SOURCE_REVISION = '679a3b3c3c56177b8df1ad82672690c6e9889aeb';
