// Installs a fake Tauri IPC layer in the browser page so the Svelte
// frontend runs unmodified against scripted backend responses.
//
// The function below is stringified and injected via `page.addInitScript`,
// so it executes in the *page* context before the app bundle loads. It must
// be fully self-contained — no imports, no closures over Node values. The
// scenario is read from `window.__SCENARIO__`, which the test seeds via a
// second addInitScript call.

export interface Scenario {
  /** auth_status response. */
  auth: { authenticated: boolean; user: unknown };
  /** list_sources response. */
  sources: unknown[];
  /** fetch_all response (repo issue search). */
  sourceResults: unknown[];
  /** Project pages to emit on fetch_all_projects_streaming, in order. */
  projectPages: unknown[];
  /** get_settings response. */
  settings: unknown;
  /** list_projects response. */
  projects: unknown[];
  /** list_repos response. */
  repos: unknown[];
  /** list_repo_labels response. */
  repoLabels: unknown[];
  /** get_issue_detail response keyed by `${repo}#${number}`, or a default. */
  issueDetail: unknown;
  /** check_for_updates response. */
  updateCheck: unknown;
  /** App version string. */
  version: string;
  /** list_issue_templates response (default for any repo). */
  issueTemplates?: unknown;
  /** Per-repo list_issue_templates responses, keyed by full_name. */
  issueTemplatesByRepo?: Record<string, unknown>;
  /** create_issue / create_issue_in_project issue payload. */
  createdIssue?: unknown;
  /** toggle_issue_state response. */
  toggledIssue?: unknown;
  /** fetch_inbox response (notification inbox items). */
  inbox?: unknown[];
  /** Per-command overrides: command name -> canned return value. */
  overrides?: Record<string, unknown>;
}

// This is the function that becomes the init script. Keep it ES5-ish and
// self-contained; it's serialized with `.toString()`.
function installTauriMock(): void {
  const w = window as unknown as {
    __TAURI_INTERNALS__: Record<string, unknown>;
    __TAURI_EVENT_PLUGIN_INTERNALS__: Record<string, unknown>;
    __SCENARIO__: Record<string, unknown>;
    __mockEmit: (event: string, payload: unknown) => void;
    __ipcLog: Array<{ cmd: string; args: unknown }>;
  };

  w.__TAURI_INTERNALS__ = w.__TAURI_INTERNALS__ || {};
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = w.__TAURI_EVENT_PLUGIN_INTERNALS__ || {};
  w.__ipcLog = [];

  // ---- callback registry (mirrors @tauri-apps/api/mocks) -------------
  const callbacks = new Map<number, (data: unknown) => unknown>();
  function registerCallback(cb: (data: unknown) => unknown, once?: boolean): number {
    const id = window.crypto.getRandomValues(new Uint32Array(1))[0];
    callbacks.set(id, (data: unknown) => {
      if (once) callbacks.delete(id);
      return cb && cb(data);
    });
    return id;
  }
  function unregisterCallback(id: number): void {
    callbacks.delete(id);
  }
  function runCallback(id: number, data: unknown): void {
    const cb = callbacks.get(id);
    if (cb) cb(data);
  }

  // ---- event plumbing ------------------------------------------------
  // event name -> array of callback ids registered via plugin:event|listen
  const listeners = new Map<string, number[]>();
  function handleListen(args: { event: string; handler: number }): number {
    if (!listeners.has(args.event)) listeners.set(args.event, []);
    listeners.get(args.event)!.push(args.handler);
    return args.handler;
  }
  function handleUnlisten(args: { event: string; eventId: number }): void {
    const arr = listeners.get(args.event);
    if (!arr) return;
    const i = arr.indexOf(args.eventId);
    if (i !== -1) arr.splice(i, 1);
  }

  // Test-facing emitter: deliver an event to every registered listener.
  w.__mockEmit = function (event: string, payload: unknown): void {
    const arr = listeners.get(event) || [];
    for (const id of arr) {
      runCallback(id, { event, id, payload });
    }
  };

  function scenario(): Record<string, unknown> {
    return w.__SCENARIO__ || {};
  }

  // ---- the IPC dispatcher -------------------------------------------
  function handle(cmd: string, args: Record<string, unknown>): unknown {
    w.__ipcLog.push({ cmd, args });
    const s = scenario();
    const overrides = (s.overrides as Record<string, unknown>) || {};
    if (Object.prototype.hasOwnProperty.call(overrides, cmd)) {
      return overrides[cmd];
    }

    switch (cmd) {
      // ---- event plugin ----
      case "plugin:event|listen":
        return handleListen(args as { event: string; handler: number });
      case "plugin:event|unlisten":
        handleUnlisten(args as { event: string; eventId: number });
        return null;
      case "plugin:event|emit":
      case "plugin:event|emit_to":
        return null;

      // ---- app / opener / notification plugins ----
      case "plugin:app|version":
        return s.version || "0.0.0-test";
      case "plugin:opener|open_url":
      case "plugin:opener|open_path":
        return null;

      // ---- auth ----
      case "auth_status":
        return s.auth || { authenticated: false, user: null };
      case "auth_start":
        return {
          device_code: "DEV-CODE",
          user_code: "ABCD-1234",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 1,
        };
      case "auth_poll":
        return { done: true, new_interval: null };
      case "auth_logout":
        return null;

      // ---- sources ----
      case "list_sources":
        return s.sources || [];
      case "save_source":
        return args.source;
      case "delete_source":
        return null;

      // ---- fetch ----
      case "fetch_all":
        return s.sourceResults || [];
      case "fetch_inbox":
        return s.inbox || [];
      case "mark_inbox_seen":
        return null;
      case "fetch_all_projects":
        return [];
      case "fetch_all_projects_streaming": {
        // Stream each configured project page as a `project-page` event,
        // on a microtask so listeners are registered first.
        const pages = (s.projectPages as unknown[]) || [];
        Promise.resolve().then(() => {
          for (const page of pages) w.__mockEmit("project-page", page);
        });
        return null;
      }

      // ---- repos / labels / projects ----
      case "list_repos":
        return s.repos || [];
      case "list_repo_labels":
        return s.repoLabels || [];
      case "list_projects":
        return s.projects || [];
      case "list_issue_templates": {
        const byRepo = (s.issueTemplatesByRepo as Record<string, unknown>) || {};
        const repo = args.repo as string;
        if (Object.prototype.hasOwnProperty.call(byRepo, repo)) return byRepo[repo];
        return s.issueTemplates || { templates: [], blank_issues_enabled: true };
      }

      // ---- mutations ----
      case "create_issue":
        return s.createdIssue || args.input;
      case "create_issue_in_project":
        return {
          issue: (s.createdIssue as Record<string, unknown>) || args.input,
          item_id: "ITEM_NEW",
        };
      case "toggle_issue_state":
        return s.toggledIssue || { number: args.number, state: "closed" };
      case "set_project_item_status":
        return null;
      case "add_issue_comment":
        return null;

      // ---- detail ----
      case "get_issue_detail":
        return s.issueDetail || { issue: null, comments: [] };

      // ---- settings / window / misc ----
      case "get_settings":
        return s.settings || {
          default_repo: null,
          poll_interval_secs: 90,
          launch_at_login: false,
          window_size: "large",
          row_density: "default",
          notifications_sync: false,
        };
      case "save_settings":
        return null;
      case "autostart_status":
        return (s.settings as Record<string, unknown>)?.launch_at_login ?? false;
      case "show_window":
      case "hide_window":
      case "set_auto_hide":
      case "open_devtools":
      case "set_tray_update_state":
      case "install_update":
        return null;
      case "quit_app":
        return null;
      case "check_for_updates":
        return s.updateCheck || { available: false, version: null, body: null };

      default:
        // Unknown command — log loudly so a missing mock is obvious in tests.
        // eslint-disable-next-line no-console
        console.warn("[tauriMock] unhandled command:", cmd, args);
        return null;
    }
  }

  w.__TAURI_INTERNALS__.transformCallback = registerCallback;
  w.__TAURI_INTERNALS__.unregisterCallback = unregisterCallback;
  w.__TAURI_INTERNALS__.runCallback = runCallback;
  w.__TAURI_INTERNALS__.callbacks = callbacks;
  w.__TAURI_INTERNALS__.invoke = function (cmd: string, args: Record<string, unknown>) {
    try {
      return Promise.resolve(handle(cmd, args || {}));
    } catch (e) {
      return Promise.reject(e);
    }
  };
  w.__TAURI_INTERNALS__.metadata = {
    currentWindow: { label: "main" },
    currentWebview: { windowLabel: "main", label: "main" },
  };
  w.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener = function (
    _event: string,
    id: number,
  ) {
    unregisterCallback(id);
  };
}

/** The init script body, as a string ready for page.addInitScript. */
export const TAURI_MOCK_INIT = `(${installTauriMock.toString()})();`;
