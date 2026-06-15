import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';

export function toonResult<T extends Record<string, unknown>>(data: T): CallToolResult & {structuredContent: T} {
	return {
		content: [],
		structuredContent: data,
	};
}
