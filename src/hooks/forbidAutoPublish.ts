const FORBIDDEN_OPERATION_TERMS = ["群发", "发布", "确认发送", "立即发送"] as const;

export function forbidAutoPublish(operationText: string): void {
  const matchedTerm = FORBIDDEN_OPERATION_TERMS.find((term) =>
    operationText.includes(term)
  );

  if (matchedTerm) {
    throw new Error(`Forbidden outbound operation term detected: ${matchedTerm}`);
  }
}
