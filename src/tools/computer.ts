import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {ComputerSessionManager} from '../computerRuntime.js';

const manager = new ComputerSessionManager();

const ActionEnum = z.enum([
	'key',
	'type',
	'mouse_move',
	'left_click',
	'left_click_drag',
	'right_click_drag',
	'right_click',
	'middle_click',
	'double_click',
	'scroll',
	'get_screenshot',
	'sleep',
]);

const coordinateSchema = z
	.array(z.number())
	.length(2)
	.describe('(x, y) coordinates in the selected monitor screenshot coordinate space');

const actionSchema = z.object({
	action: ActionEnum.describe('The action to perform'),
	monitor_id: z.string().optional().describe('Monitor id returned by computer_toggle_session; required for screenshot and coordinate actions'),
	coordinate: coordinateSchema.optional(),
	text: z.string().optional().describe('Text to type, key command, or scroll direction'),
	duration_ms: z.number().int().min(0).max(60_000).optional().describe('Sleep duration in milliseconds; required when action is sleep'),
}).strict();

const monitorInstructions = `monitors:
  source: computer_toggle_session action=start
  fields: index, monitor_id, bounds, resolution, scale_factor, visible_applications
  visible_applications: list of visible windows on that monitor with name, pid, title and global bounds
  selection: pass monitor_id to computer_use for screenshots and coordinate actions
  coordinates: local to the selected monitor screenshot, not the combined desktop
  negative_global_bounds: supported internally; agents should still use local monitor coordinates`;

const contextDescription = `tool: get_context
purpose: inspect desktop context without starting a control session
response:
  structuredContent: desktop context for MCP clients
fields:
  system: current date/time, timezone, and platform
  cursor: global coordinates plus monitor-local coordinates when inside a known monitor
  monitors: monitor index, monitor_id, bounds, and open windows with name, pid, title, and bounds`;

const focusWindowDescription = `tool: focus_window
purpose: bring a visible desktop window to the foreground by process PID or window/application name
matching:
  pid: exact process id when supplied
  name: case-insensitive OS-level match against visible window or application/process name where supported
platforms:
  win32: User32 foreground window activation
  darwin: System Events process activation
  linux: xdotool window activation when xdotool is available`;

const computerUseDescription = `tool: computer_use
purpose: interact with the desktop through an active computer-control session
session:
  required: true
  id_source: computer_toggle_session action=start
  ended_by_escape: calls return status ended with ended_by user_escape
actions:
  input_shape: actions is an ordered array; the session_id is supplied once at top level
  implicit_delay_between_actions_ms: 250
  - key: press key or key combination from text
  - type: type literal text
  - mouse_move: move cursor to coordinate on monitor_id
  - left_click: click left mouse button, optionally after moving to coordinate
  - left_click_drag: drag from current cursor to coordinate on monitor_id
  - right_click_drag: drag with right mouse button from current cursor to coordinate on monitor_id
  - right_click: click right mouse button, optionally after moving
  - middle_click: click middle mouse button, optionally after moving
  - double_click: double-click left mouse button, optionally after moving
  - scroll: scroll from coordinate; text is up, down, left, right, or direction:amount
  - get_screenshot: capture selected monitor and return image plus structured metadata
  - sleep: wait duration_ms milliseconds
queue:
  processing: one action at a time
  manual_user_input: pauses queued actions for 5 seconds from last user interaction
visual_feedback:
  active_overlay: Agent is using your computer
  paused_overlay: Paused due to user interaction
  action_feedback: pulse on the selected monitor
post_action_preview:
  delay_ms: 500
  returned_for: once after the final interactive action in actions
  image: cropped screenshot around the interaction point or current cursor
${monitorInstructions}`;

const toggleDescription = `tool: computer_toggle_session
purpose: start or end a computer-control session
actions:
  - start: starts overlay, input monitor and returns session_id plus monitor inventory
  - end: ends the active session; requires session_id
escape:
  key: ESC
  behavior: user can end the active session at any time
response:
  structuredContent: session state for MCP clients
${monitorInstructions}`;

export function registerComputer(server: McpServer): void {
	server.registerTool(
		'get_context',
		{
			title: 'Get Desktop Context',
			description: contextDescription,
			inputSchema: z.object({}).strict(),
			annotations: {
				readOnlyHint: true,
			},
		},
		async () => manager.getContext(),
	);

	server.registerTool(
		'focus_window',
		{
			title: 'Focus Window',
			description: focusWindowDescription,
			inputSchema: z.object({
				pid: z.number().int().positive().optional().describe('Process PID of the window/application to focus'),
				name: z.string().min(1).optional().describe('Window title or application/process name to focus'),
			}).strict().refine((input) => input.pid !== undefined || input.name !== undefined, {
				message: 'pid or name is required',
			}),
			annotations: {
				readOnlyHint: false,
			},
		},
		async (args) => manager.focusWindow(args as {pid?: number; name?: string}),
	);

	server.registerTool(
		'computer_toggle_session',
		{
			title: 'Toggle Computer Control Session',
			description: toggleDescription,
			inputSchema: z.object({
				action: z.enum(['start', 'end']).describe('Start or end the computer-control session'),
				session_id: z.string().optional().describe('Session id returned by action=start; required for action=end'),
			}).strict(),
			annotations: {
				readOnlyHint: false,
			},
		},
		async (args) => manager.toggleSession(args as {action: 'start' | 'end'; session_id?: string}),
	);

	server.registerTool(
		'computer_use',
		{
			title: 'Computer Use',
			description: computerUseDescription,
			inputSchema: z.object({
				session_id: z.string().describe('Active session id from computer_toggle_session'),
				actions: z.array(actionSchema).min(1).max(50).describe('Ordered desktop actions to process in one queued tool call'),
			}).strict(),
			annotations: {
				readOnlyHint: false,
			},
		},
		async (args) => manager.use(args as {
			session_id: string;
			actions: {
				action: z.infer<typeof ActionEnum>;
				monitor_id?: string;
				coordinate?: [number, number];
				text?: string;
				duration_ms?: number;
			}[];
		}),
	);
}
