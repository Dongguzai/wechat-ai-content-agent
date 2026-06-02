export type ExtractJsonSource =
  | "json_code_block"
  | "code_block"
  | "full_text"
  | "object_slice"
  | "array_slice";

export interface ExtractJsonAttemptError {
  source: ExtractJsonSource;
  parseError: string;
  contentPreview: string;
}

export interface ExtractJsonSuccess<T = unknown> {
  ok: true;
  value: T;
  source: ExtractJsonSource;
  jsonText: string;
}

export interface ExtractJsonFailure {
  ok: false;
  error: {
    message: string;
    contentPreview: string;
    attempts: ExtractJsonAttemptError[];
  };
}

export type ExtractJsonResult<T = unknown> =
  | ExtractJsonSuccess<T>
  | ExtractJsonFailure;

const previewLength = 500;
const completeThinkBlockPattern = /<think\b[^>]*>[\s\S]*?<\/think>/gi;

export function createContentPreview(text: string, length = previewLength): string {
  return text.replace(/\s+/g, " ").trim().slice(0, length);
}

function parseErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown JSON parse error.";
}

function parseCandidate<T>(
  source: ExtractJsonSource,
  jsonText: string,
  attempts: ExtractJsonAttemptError[]
): ExtractJsonSuccess<T> | undefined {
  const trimmed = jsonText.trim();

  if (!trimmed) {
    attempts.push({
      source,
      parseError: "Candidate JSON text is empty.",
      contentPreview: ""
    });
    return undefined;
  }

  try {
    return {
      ok: true,
      value: JSON.parse(trimmed) as T,
      source,
      jsonText: trimmed
    };
  } catch (error) {
    attempts.push({
      source,
      parseError: parseErrorMessage(error),
      contentPreview: createContentPreview(trimmed)
    });
    return undefined;
  }
}

function findCodeBlocks(
  text: string,
  languagePattern: RegExp
): string[] {
  const blocks: string[] = [];
  const fencePattern = /```([^\n`]*)\r?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(text)) !== null) {
    const language = match[1]?.trim() ?? "";
    if (languagePattern.test(language)) {
      blocks.push(match[2] ?? "");
    }
  }

  return blocks;
}

function objectSlice(text: string): string | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  return start >= 0 && end > start ? text.slice(start, end + 1) : undefined;
}

function arraySlice(text: string): string | undefined {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");

  return start >= 0 && end > start ? text.slice(start, end + 1) : undefined;
}

function addSliceCandidates(text: string): Array<{
  source: ExtractJsonSource;
  jsonText: string;
}> {
  const objectStart = text.indexOf("{");
  const arrayStart = text.indexOf("[");
  const object = objectSlice(text);
  const array = arraySlice(text);
  const candidates: Array<{ source: ExtractJsonSource; jsonText: string }> = [];
  const objectCandidate = object
    ? { source: "object_slice" as const, jsonText: object }
    : undefined;
  const arrayCandidate = array
    ? { source: "array_slice" as const, jsonText: array }
    : undefined;

  if (arrayStart >= 0 && (objectStart === -1 || arrayStart < objectStart)) {
    if (arrayCandidate) {
      candidates.push(arrayCandidate);
    }
    if (objectCandidate) {
      candidates.push(objectCandidate);
    }
    return candidates;
  }

  if (objectCandidate) {
    candidates.push(objectCandidate);
  }
  if (arrayCandidate) {
    candidates.push(arrayCandidate);
  }

  return candidates;
}

function stripCompleteThinkBlocks(text: string): string {
  return text.replace(completeThinkBlockPattern, "").trim();
}

export function extractJsonFromText<T = unknown>(
  text: string
): ExtractJsonResult<T> {
  const attempts: ExtractJsonAttemptError[] = [];
  const trimmed = text.trim();
  const textWithoutThinkBlocks = stripCompleteThinkBlocks(trimmed);
  const candidates: Array<{ source: ExtractJsonSource; jsonText: string }> = [
    ...findCodeBlocks(text, /^json\b/i).map((jsonText) => ({
      source: "json_code_block" as const,
      jsonText
    })),
    ...findCodeBlocks(text, /^$/).map((jsonText) => ({
      source: "code_block" as const,
      jsonText
    })),
    {
      source: "full_text",
      jsonText: trimmed
    },
    ...(textWithoutThinkBlocks && textWithoutThinkBlocks !== trimmed
      ? [
          {
            source: "full_text" as const,
            jsonText: textWithoutThinkBlocks
          },
          ...addSliceCandidates(textWithoutThinkBlocks)
        ]
      : []),
    ...addSliceCandidates(trimmed)
  ];

  for (const candidate of candidates) {
    const parsed = parseCandidate<T>(candidate.source, candidate.jsonText, attempts);
    if (parsed) {
      return parsed;
    }
  }

  return {
    ok: false,
    error: {
      message: "Text did not contain valid JSON content.",
      contentPreview: createContentPreview(text),
      attempts
    }
  };
}
