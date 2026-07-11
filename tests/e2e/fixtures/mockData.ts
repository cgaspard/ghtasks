// Realistic GitHub-shaped fixtures for driving the frontend in a browser.
// These mirror the TypeScript interfaces in src/lib/api.ts. Keep them in
// sync with that file when the IPC shapes change.
import type {
  AuthStatus,
  Issue,
  ProjectField,
  ProjectItem,
  ProjectPageEvent,
  ProjectSummary,
  Settings,
  Source,
  SourceResult,
  User,
} from "../../../src/lib/api";

export const ME: User = {
  login: "octocat",
  id: 1,
  avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
  name: "The Octocat",
  html_url: "https://github.com/octocat",
};

export const AUTHED: AuthStatus = { authenticated: true, user: ME };
export const SIGNED_OUT: AuthStatus = { authenticated: false, user: null };

export const SETTINGS: Settings = {
  default_repo: "octocat/hello-world",
  poll_interval_secs: 90,
  launch_at_login: false,
  window_size: "large",
  row_density: "default",
  notifications_sync: false,
  beta_updates: false,
};

let nodeSeq = 1000;
function nextNode(): string {
  nodeSeq += 1;
  return `NODE_${nodeSeq}`;
}

/** Build a REST-shaped Issue with sensible defaults. */
export function makeIssue(partial: Partial<Issue> & { number: number; title: string }): Issue {
  const repo = partial.repository_url ?? "https://api.github.com/repos/octocat/hello-world";
  return {
    id: partial.id ?? partial.number * 10,
    node_id: partial.node_id ?? nextNode(),
    number: partial.number,
    title: partial.title,
    html_url:
      partial.html_url ??
      `https://github.com/octocat/hello-world/issues/${partial.number}`,
    state: partial.state ?? "open",
    labels: partial.labels ?? [],
    user: partial.user ?? { login: "octocat", avatar_url: ME.avatar_url },
    assignees: partial.assignees ?? [{ login: "octocat", avatar_url: ME.avatar_url }],
    repository_url: repo,
    body: partial.body ?? null,
    comments: partial.comments ?? 0,
    updated_at: partial.updated_at ?? "2026-06-20T12:00:00Z",
    created_at: partial.created_at ?? "2026-06-19T12:00:00Z",
    pull_request: partial.pull_request ?? null,
    linked_prs: partial.linked_prs ?? [],
    milestone: partial.milestone ?? null,
  };
}

export const REPO_SOURCE: Source = {
  id: "src-repo-1",
  name: "hello-world bugs",
  enabled: true,
  color: "#e5484d",
  notify: true,
  kind: "repo",
  repo: "octocat/hello-world",
  query: "is:issue is:open assignee:@me",
};

export const PROJECT_SOURCE: Source = {
  id: "src-proj-1",
  name: "Roadmap",
  enabled: true,
  color: "#4f8cff",
  notify: true,
  kind: "project",
  project_id: "PVT_kwProject1",
  owner_login: "octocat",
  number: 7,
  title: "Roadmap",
  items_query: "-status:Released",
};

export const STATUS_FIELD: ProjectField = {
  id: "FIELD_status",
  name: "Status",
  data_type: "SINGLE_SELECT",
  options: [
    { id: "OPT_todo", name: "Todo", color: "GRAY" },
    { id: "OPT_inprogress", name: "In Progress", color: "YELLOW" },
    { id: "OPT_done", name: "Done", color: "GREEN" },
  ],
};

export const PRIORITY_FIELD: ProjectField = {
  id: "FIELD_priority",
  name: "Priority",
  data_type: "SINGLE_SELECT",
  options: [
    { id: "OPT_p0", name: "P0", color: "RED" },
    { id: "OPT_p1", name: "P1", color: "ORANGE" },
    { id: "OPT_p2", name: "P2", color: "BLUE" },
  ],
};

export const PROJECT_SUMMARY: ProjectSummary = {
  id: "PVT_kwProject1",
  number: 7,
  title: "Roadmap",
  owner_login: "octocat",
  owner_type: "organization",
  url: "https://github.com/orgs/octocat/projects/7",
  closed: false,
};

function projectItem(
  num: number,
  title: string,
  statusOptId: string | null,
  statusName: string | null,
  priorityOptId?: string,
  priorityName?: string,
  extra?: Partial<Issue>,
): ProjectItem {
  const issue = makeIssue({ number: num, title, ...extra });
  const field_values = [];
  if (statusOptId && statusName) {
    field_values.push({
      field_id: STATUS_FIELD.id,
      field_name: "Status",
      data_type: "SINGLE_SELECT",
      option_id: statusOptId,
      text: statusName,
    });
  }
  if (priorityOptId && priorityName) {
    field_values.push({
      field_id: PRIORITY_FIELD.id,
      field_name: "Priority",
      data_type: "SINGLE_SELECT",
      option_id: priorityOptId,
      text: priorityName,
    });
  }
  return {
    item_id: `ITEM_${num}`,
    issue,
    repo: "octocat/hello-world",
    field_values,
  };
}

/** A small board with a spread of statuses and issue numbers (incl. 92, 922
 * to exercise the number filter). */
export const PROJECT_ITEMS: ProjectItem[] = [
  // #92 carries a linked open PR + a milestone, exercising both badge kinds.
  projectItem(92, "Fix the login flow", "OPT_inprogress", "In Progress", "OPT_p0", "P0", {
    labels: [
      { name: "bug", color: "d73a4a" },
      { name: "auth", color: "0e8a16" },
    ],
    milestone: {
      title: "v1.0",
      url: "https://github.com/octocat/hello-world/milestone/1",
      due_on: "2026-07-31T00:00:00Z",
    },
    linked_prs: [
      {
        number: 410,
        title: "Rework the OAuth callback",
        url: "https://github.com/octocat/hello-world/pull/410",
        state: "open",
        is_draft: false,
        repo: "octocat/hello-world",
      },
    ],
  }),
  projectItem(101, "Add dark mode toggle", "OPT_todo", "Todo", "OPT_p2", "P2"),
  // #922 has a merged PR — the badge should render in the merged (purple) state.
  projectItem(922, "Refactor the sync engine", "OPT_todo", "Todo", "OPT_p1", "P1", {
    linked_prs: [
      {
        number: 411,
        title: "Split the sync engine into stages",
        url: "https://github.com/octocat/hello-world/pull/411",
        state: "merged",
        is_draft: false,
        repo: "octocat/hello-world",
      },
    ],
  }),
  projectItem(150, "Write onboarding docs", "OPT_done", "Done"),
  projectItem(200, "Investigate flaky test in CI", null, null, "OPT_p1", "P1"),
];

export const PROJECT_PAGE_EVENT: ProjectPageEvent = {
  source_id: PROJECT_SOURCE.id,
  project: PROJECT_SUMMARY,
  fields: [STATUS_FIELD, PRIORITY_FIELD],
  items: PROJECT_ITEMS,
  is_first: true,
  is_final: true,
  error: null,
};

export const REPO_ISSUES: Issue[] = [
  makeIssue({
    number: 92,
    title: "Fix the login flow",
    node_id: "AWAIT_92",
    labels: [{ name: "bug", color: "d73a4a" }],
    milestone: {
      title: "v1.0",
      url: "https://github.com/octocat/hello-world/milestone/1",
      due_on: "2026-07-31T00:00:00Z",
    },
    linked_prs: [
      {
        number: 410,
        title: "Rework the OAuth callback",
        url: "https://github.com/octocat/hello-world/pull/410",
        state: "open",
        is_draft: false,
        repo: "octocat/hello-world",
      },
    ],
  }),
  makeIssue({ number: 922, title: "Refactor the sync engine", labels: [{ name: "tech-debt", color: "0e8a16" }] }),
  makeIssue({ number: 305, title: "Update the README", labels: [] }),
];

export const SOURCE_RESULTS: SourceResult[] = [
  { source_id: REPO_SOURCE.id, issues: REPO_ISSUES, error: null },
];

/** The notification inbox — mirrors github.com/notifications: mixed reasons,
 * read + unread. The badge counts UNREAD (3 here). #92 shares a node_id with a
 * repo issue so its inline needs-response indicator shows on the Issues tab. */
export const INBOX_ITEMS = [
  {
    // Same node_id as the repo-issues #92 so its INLINE indicator shows.
    issue: makeIssue({
      number: 92,
      title: "Fix the login flow",
      node_id: "AWAIT_92",
      milestone: {
        title: "v1.0",
        url: "https://github.com/octocat/hello-world/milestone/1",
        due_on: "2026-07-31T00:00:00Z",
      },
    }),
    reason: "review_requested",
    category: "review_requested",
    addressable: true,
    thread_id: "T92",
    unread: true,
    is_pr: true,
    event_at: "2026-06-25T09:00:00Z",
  },
  {
    issue: makeIssue({
      number: 88,
      title: "Rework the OAuth callback",
      html_url: "https://github.com/octocat/hello-world/pull/88",
    }),
    reason: "mention",
    category: "mentioned",
    addressable: true,
    thread_id: "T88",
    unread: true,
    is_pr: true,
    event_at: "2026-06-24T09:00:00Z",
  },
  {
    issue: makeIssue({
      number: 70,
      title: "Split the sync engine into stages",
      html_url: "https://github.com/octocat/hello-world/pull/70",
    }),
    reason: "comment",
    category: "participating",
    addressable: true,
    thread_id: "T70",
    unread: false, // already read — shows dimmed
    is_pr: true,
    event_at: "2026-06-23T09:00:00Z",
  },
  {
    // Assigned: appears under the Assigned chip; assignments are NOT unread-
    // notifications here, so don't feed the unread badge.
    issue: makeIssue({
      number: 1371,
      title: "Bug: browser controls missing on facility windows",
      html_url: "https://github.com/octocat/hello-world/issues/1371",
    }),
    reason: "assign",
    category: "assigned",
    addressable: true,
    thread_id: "T1371",
    unread: true,
    is_pr: false,
    event_at: "2026-06-20T09:00:00Z",
  },
  {
    // A "subscribed" notification — in the inbox (All), but not a needs-response
    // and not shown as an inline indicator on Projects/Issues.
    issue: makeIssue({
      number: 55,
      title: "Bump dependencies",
      html_url: "https://github.com/octocat/hello-world/pull/55",
    }),
    reason: "subscribed",
    category: "other",
    addressable: true,
    thread_id: "T55",
    unread: true,
    is_pr: true,
    event_at: "2026-06-19T09:00:00Z",
  },
  {
    // A CheckSuite / CI-activity notification — no linked issue/PR. Shows in the
    // inbox (full mirror), links to the repo, and IS a desktop-notify trigger.
    issue: makeIssue({
      number: 0,
      title: "CI workflow run failed for main",
      html_url: "https://github.com/octocat/hello-world",
    }),
    reason: "ci_activity",
    category: "other",
    addressable: false,
    thread_id: "TCI",
    unread: true,
    is_pr: false,
    event_at: "2026-06-18T09:00:00Z",
  },
];

/** A second inbox "page" (older items) for infinite-scroll tests — distinct
 * node_ids/titles from INBOX_ITEMS so appended rows are easy to assert on. */
export const INBOX_PAGE_2 = [
  {
    issue: makeIssue({
      number: 12,
      title: "Archive the legacy webhook handler",
      html_url: "https://github.com/octocat/hello-world/issues/12",
      node_id: "AWAIT_OLD_12",
    }),
    reason: "comment",
    category: "participating",
    addressable: true,
    thread_id: "TOLD12",
    unread: false,
    is_pr: false,
    event_at: "2026-05-01T09:00:00Z",
  },
];
