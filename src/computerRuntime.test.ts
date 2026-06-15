import {
	beforeEach, describe, expect, it, vi,
} from 'vitest';
import type {ComputerDriver, InputMonitor, MonitorSnapshot} from './computerRuntime.js';

const mousePosition = {x: 10, y: 20};
const Key = new Proxy({}, {get: (_, property) => property});
const mouseSetPosition = vi.fn(async (point: {x: number; y: number}) => {
	mousePosition.x = point.x;
	mousePosition.y = point.y;
});
const mousePressButton = vi.fn(async () => undefined);
const mouseReleaseButton = vi.fn(async () => undefined);

vi.mock('@nut-tree-fork/nut-js', () => ({
	Button: {LEFT: 'left', MIDDLE: 'middle', RIGHT: 'right'},
	Key,
	Point: class Point {
		constructor(public x: number, public y: number) { }
	},
	keyboard: {
		config: {},
		pressKey: vi.fn(async () => undefined),
		releaseKey: vi.fn(async () => undefined),
		type: vi.fn(async () => undefined),
	},
	mouse: {
		config: {},
		getPosition: vi.fn(async () => mousePosition),
		setPosition: mouseSetPosition,
		leftClick: vi.fn(async () => undefined),
		rightClick: vi.fn(async () => undefined),
		click: vi.fn(async () => undefined),
		doubleClick: vi.fn(async () => undefined),
		pressButton: mousePressButton,
		releaseButton: mouseReleaseButton,
		scrollUp: vi.fn(async () => undefined),
		scrollDown: vi.fn(async () => undefined),
		scrollLeft: vi.fn(async () => undefined),
		scrollRight: vi.fn(async () => undefined),
	},
}));

const {keyboard} = await import('@nut-tree-fork/nut-js');

const {
	ActionQueue,
	ComputerSessionManager,
	localToGlobal,
} = await import('./computerRuntime.js');

const emptyWindows = async () => [];

class FakeDriver implements ComputerDriver {
	displays = [
		{
			id: 'primary', index: 1, name: 'Primary', x: 0, y: 0, width: 100, height: 100, scale_factor: 1, is_primary: true,
		},
		{
			id: 'left', index: 2, name: 'Left', x: -80, y: 0, width: 80, height: 100, scale_factor: 1, is_primary: false,
		},
	];

	statuses: {status: 'active' | 'paused'; text: string}[] = [];
	flashes: {monitorId: string; x: number; y: number}[] = [];
	escapeCallback?: () => void;
	displaysChangedCallback?: () => void;

	async listDisplays() {
		return this.displays;
	}

	async showOverlay() {
		return this.displays;
	}

	async hideOverlay() {
		await Promise.resolve();
	}

	async setOverlayStatus(status: 'active' | 'paused', text: string) {
		this.statuses.push({status, text});
	}

	async flash(monitorId: string, x: number, y: number) {
		this.flashes.push({monitorId, x, y});
	}

	async screenshot() {
		return {
			data: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
			width: 1,
			height: 1,
		};
	}

	onEscape(callback: () => void) {
		this.escapeCallback = callback;
	}

	onDisplaysChanged(callback: () => void) {
		this.displaysChangedCallback = callback;
	}

	async dispose() {
		await Promise.resolve();
	}
}

class FakeInputMonitor implements InputMonitor {
	inputCallback?: () => void;
	escapeCallback?: () => void;

	async start(inputCallback: () => void, escapeCallback: () => void) {
		this.inputCallback = inputCallback;
		this.escapeCallback = escapeCallback;
	}

	stop() {
		this.inputCallback = undefined;
		this.escapeCallback = undefined;
	}
}

describe('computer runtime', () => {
	beforeEach(() => {
		mousePosition.x = 10;
		mousePosition.y = 20;
		mouseSetPosition.mockClear();
		mousePressButton.mockClear();
		mouseReleaseButton.mockClear();
		vi.useRealTimers();
	});

	it('does not pause queued actions when the agent moves the mouse', async () => {
		vi.useFakeTimers();
		const driver = new FakeDriver();
		const input = new FakeInputMonitor();
		const manager = new ComputerSessionManager(driver, input, emptyWindows);
		const started = await manager.toggleSession({action: 'start'});
		const session = started.structuredContent.session as {session_id: string};

		mouseSetPosition.mockImplementationOnce(async (point: {x: number; y: number}) => {
			mousePosition.x = point.x;
			mousePosition.y = point.y;
			input.inputCallback?.();
		});
		const action = manager.use({
			session_id: session.session_id,
			actions: [
				{action: 'mouse_move', monitor_id: 'primary', coordinate: [10, 10]},
				{action: 'mouse_move', monitor_id: 'primary', coordinate: [20, 20]},
			],
		});
		await vi.runAllTimersAsync();
		const result = await action;

		expect(result.structuredContent.ok).toBe(true);
		expect(mouseSetPosition).toHaveBeenCalledTimes(2);
		expect(driver.statuses.some((entry) => entry.status === 'paused')).toBe(false);
	});

	it('sends agent ESC without ending the session', async () => {
		vi.useFakeTimers();
		const input = new FakeInputMonitor();
		const manager = new ComputerSessionManager(new FakeDriver(), input, emptyWindows);
		const started = await manager.toggleSession({action: 'start'});
		const session = started.structuredContent.session as {session_id: string};
		vi.mocked(keyboard.pressKey).mockImplementationOnce(async () => {
			input.escapeCallback?.();
		});

		const action = manager.use({
			session_id: session.session_id,
			actions: [{action: 'key', text: 'Escape'}],
		});
		await vi.runAllTimersAsync();
		const result = await action;
		const afterEscape = await manager.use({session_id: session.session_id, actions: [{action: 'sleep', duration_ms: 0}]});

		expect(result.structuredContent.ok).toBe(true);
		expect(afterEscape.structuredContent.ok).toBe(true);
	});

	it('converts local monitor screenshot coordinates to global coordinates, including negative bounds', () => {
		const monitor: MonitorSnapshot = {
			monitor_id: 'left',
			index: 2,
			name: 'Left',
			x: -80,
			y: 0,
			width: 80,
			height: 100,
			scale_factor: 1,
			is_primary: false,
			visible_applications: [],
		};

		expect(localToGlobal(monitor, [40, 50], {width: 80, height: 100})).toEqual({
			x: -40,
			y: 50,
			local_x: 40,
			local_y: 50,
		});
	});

	it('starts a session and rejects computer_use without the active token', async () => {
		const manager = new ComputerSessionManager(new FakeDriver(), new FakeInputMonitor(), emptyWindows);
		const started = await manager.toggleSession({action: 'start'});
		const session = started.structuredContent.session as {session_id: string};

		expect(started.content).toEqual([]);
		expect(session.session_id).toBeTruthy();

		const invalid = await manager.use({session_id: 'wrong', actions: [{action: 'sleep', duration_ms: 0}]});
		expect(invalid.structuredContent.status).toBe('invalid_session');
	});

	it('includes visible applications by monitor bounds when starting a session', async () => {
		const manager = new ComputerSessionManager(new FakeDriver(), new FakeInputMonitor(), async () => [
			{
				id: 1, name: 'Editor', pid: 101, title: 'Code', bounds: {
					x: 10, y: 10, width: 50, height: 50,
				},
			},
			{
				id: 2, name: 'Chat', pid: 102, title: 'Codex', bounds: {
					x: -60, y: 5, width: 40, height: 40,
				},
			},
			{
				id: 3, name: 'Bridge', pid: 103, title: 'Spanning', bounds: {
					x: -10, y: 0, width: 30, height: 30,
				},
			},
		]);
		const started = await manager.toggleSession({action: 'start'});
		const monitors = started.structuredContent.monitors as MonitorSnapshot[];
		const primary = monitors.find((monitor) => monitor.monitor_id === 'primary');
		const left = monitors.find((monitor) => monitor.monitor_id === 'left');

		expect(primary?.visible_applications.map((app) => app.name)).toEqual(['Editor', 'Bridge']);
		expect(primary?.visible_applications.map((app) => app.pid)).toEqual([101, 103]);
		expect(left?.visible_applications.map((app) => app.name)).toEqual(['Chat', 'Bridge']);
		expect(primary).toMatchObject({
			index: 1,
			x: 0,
			y: 0,
			width: 100,
			height: 100,
		});
	});

	it('returns desktop context with monitor bounds, window pids, system time, and cursor position', async () => {
		mousePosition.x = -40;
		mousePosition.y = 10;
		const manager = new ComputerSessionManager(new FakeDriver(), new FakeInputMonitor(), async () => [
			{
				id: 1, name: 'Editor', pid: 101, title: 'Code', bounds: {
					x: 10, y: 10, width: 50, height: 50,
				},
			},
			{
				id: 2, name: 'Chat', pid: 102, title: 'Codex', bounds: {
					x: -60, y: 5, width: 40, height: 40,
				},
			},
		]);
		const result = await manager.getContext();

		expect(result.structuredContent.system).toMatchObject({
			platform: process.platform,
		});
		expect(result.structuredContent.cursor).toMatchObject({
			global_x: -40,
			global_y: 10,
			monitor_id: 'left',
			x: 40,
			y: 10,
		});
		expect(result.structuredContent.monitors).toEqual(expect.arrayContaining([
			expect.objectContaining({
				index: 2,
				bounds: {
					x: -80, y: 0, width: 80, height: 100,
				},
				windows: [expect.objectContaining({name: 'Chat', pid: 102})],
			}),
		]));
	});

	it('focuses a window by pid or name through the injected focuser', async () => {
		const focuser = vi.fn(async (input) => ({pid: input.pid ?? null, name: input.name ?? null}));
		const manager = new ComputerSessionManager(new FakeDriver(), new FakeInputMonitor(), emptyWindows, focuser);
		const result = await manager.focusWindow({pid: 1234});

		expect(focuser).toHaveBeenCalledWith({pid: 1234});
		expect(result.structuredContent).toEqual({
			ok: true,
			focused: {pid: 1234, name: null},
		});
	});

	it('pauses queued actions for five seconds after manual input', async () => {
		vi.useFakeTimers();
		const driver = new FakeDriver();
		const input = new FakeInputMonitor();
		const manager = new ComputerSessionManager(driver, input, emptyWindows);
		const started = await manager.toggleSession({action: 'start'});
		const session = started.structuredContent.session as {session_id: string};

		input.inputCallback?.();
		const action = manager.use({
			session_id: session.session_id,
			actions: [{
				action: 'mouse_move',
				monitor_id: 'primary',
				coordinate: [50, 50],
			}],
		});
		await vi.advanceTimersByTimeAsync(4900);
		expect(mouseSetPosition).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(200);
		const result = await action;

		expect(result.structuredContent.ok).toBe(true);
		expect(mouseSetPosition).toHaveBeenCalledTimes(1);
		expect(driver.statuses.some((entry) => entry.status === 'paused')).toBe(true);
	});

	it('returns a cropped preview 500ms after click actions using current cursor when no coordinate is supplied', async () => {
		vi.useFakeTimers();
		mousePosition.x = 25;
		mousePosition.y = 35;
		const manager = new ComputerSessionManager(new FakeDriver(), new FakeInputMonitor(), emptyWindows);
		const started = await manager.toggleSession({action: 'start'});
		const session = started.structuredContent.session as {session_id: string};
		let settled = false;

		const action = manager.use({
			session_id: session.session_id,
			actions: [{action: 'left_click'}],
		});
		void action.then(() => {
			settled = true;
		});
		await vi.advanceTimersByTimeAsync(499);
		expect(settled).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		const result = await action;

		expect(result.content.map((item) => item.type)).toEqual(['image']);
		expect(result.structuredContent.interaction_preview).toMatchObject({
			ok: true,
			monitor_id: 'primary',
			delay_ms: 500,
		});
		expect((result.structuredContent.steps as Record<string, unknown>[])[0]).toMatchObject({
			target: {
				x: 25,
				y: 35,
				local_x: 25,
				local_y: 35,
			},
		});
	});

	it('runs action arrays with 250ms between actions and supports sleep', async () => {
		vi.useFakeTimers();
		const manager = new ComputerSessionManager(new FakeDriver(), new FakeInputMonitor(), emptyWindows);
		const started = await manager.toggleSession({action: 'start'});
		const session = started.structuredContent.session as {session_id: string};

		const movement = manager.use({
			session_id: session.session_id,
			actions: [
				{action: 'mouse_move', monitor_id: 'primary', coordinate: [10, 10]},
				{action: 'mouse_move', monitor_id: 'primary', coordinate: [20, 20]},
			],
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(mouseSetPosition).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(249);
		expect(mouseSetPosition).toHaveBeenCalledTimes(1);
		await vi.runAllTimersAsync();
		const movementResult = await movement;
		expect(mouseSetPosition).toHaveBeenCalledTimes(2);
		expect(movementResult.structuredContent.delay_between_actions_ms).toBe(250);
		expect((movementResult.structuredContent.steps as {action: string}[]).map((step) => step.action)).toEqual(['mouse_move', 'mouse_move']);
		expect(movementResult.structuredContent.interaction_preview).toMatchObject({ok: true, delay_ms: 500});

		mouseSetPosition.mockClear();
		const slept = manager.use({
			session_id: session.session_id,
			actions: [
				{action: 'sleep', duration_ms: 1000},
				{action: 'mouse_move', monitor_id: 'primary', coordinate: [30, 30]},
			],
		});
		await vi.advanceTimersByTimeAsync(999);
		expect(mouseSetPosition).not.toHaveBeenCalled();
		await vi.runAllTimersAsync();
		const sleepResult = await slept;

		expect(mouseSetPosition).toHaveBeenCalledTimes(1);
		expect((sleepResult.structuredContent.steps as {action: string}[]).map((step) => step.action)).toEqual(['sleep', 'mouse_move']);
	});

	it('drags with the right mouse button', async () => {
		vi.useFakeTimers();
		const manager = new ComputerSessionManager(new FakeDriver(), new FakeInputMonitor(), emptyWindows);
		const started = await manager.toggleSession({action: 'start'});
		const session = started.structuredContent.session as {session_id: string};

		const action = manager.use({
			session_id: session.session_id,
			actions: [{action: 'right_click_drag', monitor_id: 'primary', coordinate: [20, 30]}],
		});
		await vi.runAllTimersAsync();
		const result = await action;

		expect(result.structuredContent.ok).toBe(true);
		expect(mousePressButton).toHaveBeenCalledWith('right');
		expect(mouseReleaseButton).toHaveBeenCalledWith('right');
		expect(mouseSetPosition).toHaveBeenCalledWith(expect.objectContaining({x: 20, y: 30}));
	});

	it('serializes queued actions in order', async () => {
		const queue = new ActionQueue();
		const events: string[] = [];
		const first = queue.enqueue(async () => {
			events.push('first:start');
			await new Promise((resolve) => {
				setTimeout(resolve, 20);
			});
			events.push('first:end');
		});
		const second = queue.enqueue(async () => {
			events.push('second');
		});
		await Promise.all([first, second]);

		expect(events).toEqual(['first:start', 'first:end', 'second']);
	});

	it('reports sessions ended by escape to the agent', async () => {
		const input = new FakeInputMonitor();
		const manager = new ComputerSessionManager(new FakeDriver(), input, emptyWindows);
		const started = await manager.toggleSession({action: 'start'});
		const session = started.structuredContent.session as {session_id: string};

		input.escapeCallback?.();
		await Promise.resolve();
		const afterEscape = await manager.use({session_id: session.session_id, actions: [{action: 'sleep', duration_ms: 0}]});

		expect(afterEscape.structuredContent.status).toBe('ended');
		expect((afterEscape.structuredContent.session as {ended_by: string}).ended_by).toBe('user_escape');
	});
});
