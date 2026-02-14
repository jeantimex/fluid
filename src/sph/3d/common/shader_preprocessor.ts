/**
 * Simple shader preprocessor to handle #include directives.
 * WebGPU does not natively support #include, so we manually substitute the content.
 */
export function preprocessShader(
  source: string,
  includes: Record<string, string>
): string {
  let processed = source;
  for (const [key, content] of Object.entries(includes)) {
    // Escape regex special characters in the key if necessary,
    // but for simple filenames standard replace is often sufficient
    // if we don't use regex for the key itself.
    // However, to match the exact #include line:
    const pattern = `#include "${key}"`;
    // Replace all occurrences
    processed = processed.split(pattern).join(content);
  }
  return processed;
}
