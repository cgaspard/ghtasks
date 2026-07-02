// Rich, believable fixtures used ONLY for marketing captures (screenshots +
// video). Not asserted on by any test — this is the "hero" dataset: varied
// statuses, priorities, labels, linked PRs in every state, milestones, and a
// full notifications inbox, so the app looks alive in stills.
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
import { makeIssue } from "./mockData";

const HERO_AVATAR = "https://avatars.githubusercontent.com/u/9919?v=4";
const ME_ASSIGNEE = [{ login: "rileydev", avatar_url: HERO_AVATAR }];

/** Like makeIssue, but assigned to the hero user so the default "Mine"
 * toggle (on both Projects and Issues) keeps the item visible. */
function heroIssue(
  partial: Parameters<typeof makeIssue>[0],
): ReturnType<typeof makeIssue> {
  return makeIssue({
    user: { login: "rileydev", avatar_url: HERO_AVATAR },
    assignees: ME_ASSIGNEE,
    ...partial,
  });
}

export const HERO_ME: User = {
  login: "rileydev",
  id: 42,
  avatar_url: "https://avatars.githubusercontent.com/u/9919?v=4", // GitHub org octocat-ish avatar
  name: "Riley",
  html_url: "https://github.com/rileydev",
};

export const HERO_AUTH: AuthStatus = { authenticated: true, user: HERO_ME };

export const HERO_SETTINGS: Settings = {
  default_repo: "acme/webapp",
  poll_interval_secs: 90,
  launch_at_login: true,
  window_size: "large",
  row_density: "default",
  notifications_sync: true,
};

// ---- Sources: an indie dev driving personal + work + review queue ----------
export const HERO_SOURCES: Source[] = [
  {
    id: "src-proj-roadmap",
    name: "Product Roadmap",
    enabled: true,
    color: "#4f8cff",
    notify: true,
    kind: "project",
    project_id: "PVT_kwHeroRoadmap",
    owner_login: "acme",
    number: 3,
    title: "Product Roadmap",
    items_query: "-status:Released",
  },
  {
    id: "src-repo-assigned",
    name: "Assigned to me",
    enabled: true,
    color: "#a371f7",
    notify: true,
    kind: "repo",
    repo: "acme/webapp",
    query: "is:issue is:open assignee:@me",
  },
  {
    id: "src-repo-reviews",
    name: "Review queue",
    enabled: true,
    color: "#3fb950",
    notify: true,
    kind: "repo",
    repo: "acme/webapp",
    query: "is:pr is:open review-requested:@me",
  },
  {
    id: "src-repo-personal",
    name: "Side project",
    enabled: false,
    color: "#f0883e",
    notify: false,
    kind: "repo",
    repo: "rileydev/notes",
    query: "is:issue is:open",
  },
];

// ---- Project board fields --------------------------------------------------
const HERO_STATUS: ProjectField = {
  id: "F_status",
  name: "Status",
  data_type: "SINGLE_SELECT",
  options: [
    { id: "S_backlog", name: "Backlog", color: "GRAY" },
    { id: "S_todo", name: "Todo", color: "BLUE" },
    { id: "S_inprogress", name: "In Progress", color: "YELLOW" },
    { id: "S_review", name: "In Review", color: "PURPLE" },
    { id: "S_done", name: "Done", color: "GREEN" },
  ],
};

const HERO_PRIORITY: ProjectField = {
  id: "F_priority",
  name: "Priority",
  data_type: "SINGLE_SELECT",
  options: [
    { id: "P_p0", name: "P0", color: "RED" },
    { id: "P_p1", name: "P1", color: "ORANGE" },
    { id: "P_p2", name: "P2", color: "BLUE" },
  ],
};

const HERO_PROJECT: ProjectSummary = {
  id: "PVT_kwHeroRoadmap",
  number: 3,
  title: "Product Roadmap",
  owner_login: "acme",
  owner_type: "organization",
  url: "https://github.com/orgs/acme/projects/3",
  closed: false,
};

const REPO = "https://api.github.com/repos/acme/webapp";

function item(
  num: number,
  title: string,
  statusId: string,
  statusName: string,
  prioId: string,
  prioName: string,
  extra: Partial<Issue> = {},
): ProjectItem {
  const issue = heroIssue({
    number: num,
    title,
    repository_url: REPO,
    html_url: `https://github.com/acme/webapp/issues/${num}`,
    ...extra,
  });
  return {
    item_id: `HI_${num}`,
    issue,
    repo: "acme/webapp",
    field_values: [
      {
        field_id: HERO_STATUS.id,
        field_name: "Status",
        data_type: "SINGLE_SELECT",
        option_id: statusId,
        text: statusName,
      },
      {
        field_id: HERO_PRIORITY.id,
        field_name: "Priority",
        data_type: "SINGLE_SELECT",
        option_id: prioId,
        text: prioName,
      },
    ],
  };
}

const v14 = {
  title: "v1.4",
  url: "https://github.com/acme/webapp/milestone/4",
  due_on: "2026-08-15T00:00:00Z",
};

export const HERO_PROJECT_ITEMS: ProjectItem[] = [
  item(
    284,
    "Payments: retry failed Stripe webhooks",
    "S_inprogress",
    "In Progress",
    "P_p0",
    "P0",
    {
      labels: [
        { name: "bug", color: "d73a4a" },
        { name: "payments", color: "0e8a16" },
      ],
      milestone: v14,
      linked_prs: [
        {
          number: 501,
          title: "Add idempotent webhook retry queue",
          url: "https://github.com/acme/webapp/pull/501",
          state: "open",
          is_draft: false,
          repo: "acme/webapp",
        },
      ],
    },
  ),
  item(
    277,
    "Dark mode across the dashboard",
    "S_review",
    "In Review",
    "P_p1",
    "P1",
    {
      labels: [{ name: "enhancement", color: "a2eeef" }],
      linked_prs: [
        {
          number: 498,
          title: "Theme tokens + dark palette",
          url: "https://github.com/acme/webapp/pull/498",
          state: "open",
          is_draft: true,
          repo: "acme/webapp",
        },
      ],
    },
  ),
  item(
    262,
    "Onboarding: skip-tour for returning users",
    "S_todo",
    "Todo",
    "P_p2",
    "P2",
    { labels: [{ name: "ux", color: "d4c5f9" }] },
  ),
  item(
    240,
    "Migrate search to the new index cluster",
    "S_inprogress",
    "In Progress",
    "P_p1",
    "P1",
    {
      labels: [
        { name: "infra", color: "5319e7" },
        { name: "tech-debt", color: "fbca04" },
      ],
      milestone: v14,
      linked_prs: [
        {
          number: 495,
          title: "Cut over search reads to the v2 cluster",
          url: "https://github.com/acme/webapp/pull/495",
          state: "merged",
          is_draft: false,
          repo: "acme/webapp",
        },
      ],
    },
  ),
  item(
    233,
    "Rate-limit the public API",
    "S_backlog",
    "Backlog",
    "P_p2",
    "P2",
    { labels: [{ name: "security", color: "b60205" }] },
  ),
  item(
    229,
    "Ship the mobile responsive nav",
    "S_done",
    "Done",
    "P_p1",
    "P1",
    {
      labels: [{ name: "mobile", color: "1d76db" }],
      linked_prs: [
        {
          number: 480,
          title: "Responsive top nav + drawer",
          url: "https://github.com/acme/webapp/pull/480",
          state: "merged",
          is_draft: false,
          repo: "acme/webapp",
        },
      ],
    },
  ),
  item(
    215,
    "Flaky test: checkout e2e times out on CI",
    "S_todo",
    "Todo",
    "P_p0",
    "P0",
    { labels: [{ name: "flaky", color: "e99695" }, { name: "ci", color: "ededed" }] },
  ),
];

// Spread believable recent "updated" times across the board so the rows don't
// all read the same relative age. Anchored near the capture date; the app
// renders these as "3h", "8h", "1d", … via the real clock.
const RECENT = [
  "2026-07-02T18:20:00Z",
  "2026-07-02T13:05:00Z",
  "2026-07-01T22:40:00Z",
  "2026-07-01T09:15:00Z",
  "2026-06-30T16:00:00Z",
  "2026-06-29T11:30:00Z",
  "2026-06-28T08:45:00Z",
];
HERO_PROJECT_ITEMS.forEach((it, i) => {
  it.issue.updated_at = RECENT[i % RECENT.length];
});

export const HERO_PROJECT_PAGE: ProjectPageEvent = {
  source_id: "src-proj-roadmap",
  project: HERO_PROJECT,
  fields: [HERO_STATUS, HERO_PRIORITY],
  items: HERO_PROJECT_ITEMS,
  is_first: true,
  is_final: true,
  error: null,
};

// ---- Issues tab (repo search results across two enabled repo sources) ------
export const HERO_ASSIGNED_ISSUES: Issue[] = [
  heroIssue({
    number: 284,
    title: "Payments: retry failed Stripe webhooks",
    repository_url: REPO,
    html_url: "https://github.com/acme/webapp/issues/284",
    node_id: "INB_284",
    labels: [
      { name: "bug", color: "d73a4a" },
      { name: "payments", color: "0e8a16" },
    ],
    milestone: v14,
    linked_prs: [
      {
        number: 501,
        title: "Add idempotent webhook retry queue",
        url: "https://github.com/acme/webapp/pull/501",
        state: "open",
        is_draft: false,
        repo: "acme/webapp",
      },
    ],
  }),
  heroIssue({
    number: 240,
    title: "Migrate search to the new index cluster",
    repository_url: REPO,
    html_url: "https://github.com/acme/webapp/issues/240",
    labels: [{ name: "infra", color: "5319e7" }],
    linked_prs: [
      {
        number: 495,
        title: "Cut over search reads to the v2 cluster",
        url: "https://github.com/acme/webapp/pull/495",
        state: "merged",
        is_draft: false,
        repo: "acme/webapp",
      },
    ],
  }),
  heroIssue({
    number: 215,
    title: "Flaky test: checkout e2e times out on CI",
    repository_url: REPO,
    html_url: "https://github.com/acme/webapp/issues/215",
    labels: [{ name: "flaky", color: "e99695" }],
  }),
];

export const HERO_REVIEW_PRS: Issue[] = [
  heroIssue({
    number: 498,
    title: "Theme tokens + dark palette",
    repository_url: REPO,
    html_url: "https://github.com/acme/webapp/pull/498",
    labels: [{ name: "enhancement", color: "a2eeef" }],
    pull_request: {},
  }),
  heroIssue({
    number: 495,
    title: "Cut over search reads to the v2 cluster",
    repository_url: REPO,
    html_url: "https://github.com/acme/webapp/pull/495",
    labels: [{ name: "infra", color: "5319e7" }],
    pull_request: {},
  }),
];

[...HERO_ASSIGNED_ISSUES, ...HERO_REVIEW_PRS].forEach((iss, i) => {
  iss.updated_at = RECENT[i % RECENT.length];
});

export const HERO_SOURCE_RESULTS: SourceResult[] = [
  { source_id: "src-repo-assigned", issues: HERO_ASSIGNED_ISSUES, error: null },
  { source_id: "src-repo-reviews", issues: HERO_REVIEW_PRS, error: null },
];

// ---- Inbox: a full, believable notifications mirror ------------------------
function inbox(
  number: number,
  title: string,
  reason: string,
  category: string,
  unread: boolean,
  is_pr: boolean,
  event_at: string,
  opts: { addressable?: boolean; node_id?: string; html_url?: string } = {},
) {
  const addressable = opts.addressable ?? true;
  return {
    issue: makeIssue({
      number,
      title,
      repository_url: REPO,
      node_id: opts.node_id,
      html_url:
        opts.html_url ??
        `https://github.com/acme/webapp/${is_pr ? "pull" : "issues"}/${number}`,
    }),
    reason,
    category,
    addressable,
    thread_id: `HT_${number}`,
    unread,
    is_pr,
    event_at,
  };
}

export const HERO_INBOX = [
  inbox(498, "Theme tokens + dark palette", "review_requested", "review_requested", true, true, "2026-07-02T20:30:00Z"),
  inbox(284, "Payments: retry failed Stripe webhooks", "mention", "mentioned", true, false, "2026-07-02T19:05:00Z", { node_id: "INB_284" }),
  inbox(501, "Add idempotent webhook retry queue", "mention", "mentioned", true, true, "2026-07-02T18:40:00Z"),
  inbox(495, "Cut over search reads to the v2 cluster", "comment", "participating", true, true, "2026-07-02T17:15:00Z"),
  inbox(233, "Rate-limit the public API", "assign", "assigned", true, false, "2026-07-02T14:00:00Z"),
  inbox(480, "Responsive top nav + drawer", "comment", "participating", false, true, "2026-07-01T22:10:00Z"),
  inbox(0, "CI run failed on main — deploy blocked", "ci_activity", "other", true, false, "2026-07-01T20:00:00Z", { addressable: false, html_url: "https://github.com/acme/webapp" }),
  inbox(462, "Weekly dependency bumps", "subscribed", "other", false, true, "2026-07-01T09:00:00Z"),
  inbox(455, "Discussion: 2026 platform priorities", "subscribed", "other", false, false, "2026-06-30T16:30:00Z", { addressable: false, html_url: "https://github.com/acme/webapp/discussions/455" }),
];

export const HERO_PROJECT_SUMMARIES: ProjectSummary[] = [HERO_PROJECT];

export const HERO_REPOS = [
  {
    id: 1,
    name: "webapp",
    full_name: "acme/webapp",
    private: true,
    html_url: "https://github.com/acme/webapp",
    description: "The Acme customer dashboard",
    archived: false,
    open_issues_count: 47,
  },
  {
    id: 2,
    name: "notes",
    full_name: "rileydev/notes",
    private: false,
    html_url: "https://github.com/rileydev/notes",
    description: "Personal notes & side-project tracker",
    archived: false,
    open_issues_count: 9,
  },
];
