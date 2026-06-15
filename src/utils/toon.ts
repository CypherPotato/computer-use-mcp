type ToonValue = null | string | number | boolean | ToonValue[] | {[key: string]: ToonValue | undefined};

function formatScalar(value: null | string | number | boolean): string {
	if (value === null) {
		return 'null';
	}

	if (typeof value === 'string') {
		return value.includes('\n') ? value.replaceAll('\n', '\\n') : value;
	}

	return String(value);
}

function writeValue(lines: string[], key: string, value: ToonValue | undefined, indent: string): void {
	if (value === undefined) {
		return;
	}

	if (value === null || typeof value !== 'object') {
		lines.push(`${indent}${key}: ${formatScalar(value)}`);
		return;
	}

	if (Array.isArray(value)) {
		lines.push(`${indent}${key}[${value.length}]:`);
		for (const item of value) {
			if (item === null || typeof item !== 'object' || Array.isArray(item)) {
				lines.push(`${indent}  - ${formatScalar(item as null | string | number | boolean)}`);
				continue;
			}

			const entries = Object.entries(item).filter(([, entryValue]) => entryValue !== undefined);
			if (entries.length === 0) {
				lines.push(`${indent}  -`);
				continue;
			}

			const [firstKey, rawFirstValue] = entries[0]!;
			const firstValue = rawFirstValue as ToonValue;
			if (firstValue === null || typeof firstValue !== 'object') {
				lines.push(`${indent}  - ${firstKey}: ${formatScalar(firstValue)}`);
			} else if (Array.isArray(firstValue)) {
				lines.push(`${indent}  - ${firstKey}:`);
				writeValue(lines, 'items', firstValue, `${indent}      `);
			} else {
				lines.push(`${indent}  - ${firstKey}:`);
				writeNested(lines, firstValue, `${indent}      `);
			}

			for (const [entryKey, entryValue] of entries.slice(1)) {
				writeValue(lines, entryKey, entryValue, `${indent}    `);
			}
		}

		return;
	}

	lines.push(`${indent}${key}:`);
	writeNested(lines, value, `${indent}  `);
}

function writeNested(lines: string[], value: Record<string, ToonValue | undefined>, indent: string): void {
	for (const [key, entryValue] of Object.entries(value)) {
		writeValue(lines, key, entryValue, indent);
	}
}

export function toToon<T extends Record<string, unknown>>(data: T, root = 'result'): string {
	const lines = [`${root}:`];
	writeNested(lines, data as Record<string, ToonValue | undefined>, '  ');
	return lines.join('\n');
}
