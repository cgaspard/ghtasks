import { invoke } from "@tauri-apps/api/core";

export interface User {
  login: string;
  id: number;
  avatar_url: string;
  name: string | null;
  html_url: string;
}

export interface AuthStatus {
  authenticated: boolean;
  user: User | null;
}

export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface Repo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  archived: boolean;
  open_issues_count: number | null;
}

export interface IssueLabel {
  name: string;
  color: string;
}

export interface IssueUser {
  login: string;
  avatar_url: string;
}

export interface Issue {
  id: number;
  node_id: string;
  number: number;
  title: string;
  html_url: string;
  state: string;
  labels: IssueLabel[];
  user: IssueUser | null;
  assignees: IssueUser[] | null;
  repository_url: string | null;
  body: string | null;
  comments: number | null;
  updated_at: string;
  created_at: string;
  pull_request: unknown | null;
}

export interface Source {
  id: string;
  name: string;
  repo: string;
  query: string;
  enabled: boolean;
  color: string | null;
  notify: boolean;
}

export interface SourceResult {
  source_id: string;
  issues: Issue[];
  error: string | null;
}

export interface NewIssueInput {
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
  type?: string;
}

export interface Settings {
  default_repo: string | null;
  poll_interval_secs: number;
  launch_at_login: boolean;
}

export const api = {
  authStatus: () => invoke<AuthStatus>("auth_status"),
  authStart: () => invoke<DeviceCode>("auth_start"),
  authPoll: (device_code: string) =>
    invoke<boolean>("auth_poll", { deviceCode: device_code }),
  authLogout: () => invoke<void>("auth_logout"),
  listRepos: () => invoke<Repo[]>("list_repos"),
  listSources: () => invoke<Source[]>("list_sources"),
  saveSource: (source: Source) => invoke<Source>("save_source", { source }),
  deleteSource: (id: string) => invoke<void>("delete_source", { id }),
  fetchAll: () => invoke<SourceResult[]>("fetch_all"),
  createIssue: (repo: string, input: NewIssueInput) =>
    invoke<Issue>("create_issue", { repo, input }),
  toggleIssueState: (repo: string, number: number, closed: boolean) =>
    invoke<Issue>("toggle_issue_state", { repo, number, closed }),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) =>
    invoke<void>("save_settings", { settings }),
  showWindow: () => invoke<void>("show_window"),
  hideWindow: () => invoke<void>("hide_window"),
};

export function repoFullName(issue: Issue): string {
  if (!issue.repository_url) return "";
  return issue.repository_url.replace(
    "https://api.github.com/repos/",
    "",
  );
}
