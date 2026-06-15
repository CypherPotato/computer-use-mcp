import {describe, expect, it} from 'vitest';
import {toToon} from './toon.js';

describe('toToon', () => {
	it('serializes objects and arrays without JSON syntax', () => {
		const output = toToon({
			ok: true,
			session: {
				session_id: 'abc',
				status: 'active',
			},
			monitors: [
				{monitor_id: '1', width: 1920, height: 1080},
				{monitor_id: '2', width: 1280, height: 720},
			],
		});

		expect(output).toContain('result:');
		expect(output).toContain('ok: true');
		expect(output).toContain('monitors[2]:');
		expect(output).toContain('- monitor_id: 1');
		expect(output).not.toContain('{');
		expect(output).not.toContain('"');
	});
});
