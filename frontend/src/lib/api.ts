import { getAccessToken } from "./auth";

export const apiUrl = (import.meta.env.VITE_API_URL ?? "/api").replace(
  /\/$/,
  "",
);
export type DetectorModel = "haiku" | "sonnet";
export const modelLabels: Record<DetectorModel, string> = {
  haiku: "Quick Bite",
  sonnet: "The Food Inspector",
};
export function modelLabel(model: string) {
  return model === "haiku" || model.includes("haiku")
    ? modelLabels.haiku
    : model === "sonnet" || model.includes("sonnet")
      ? modelLabels.sonnet
      : "Food detector";
}
export type PhotoResult = {
  is_hot_dog: boolean;
  certificate_id: string;
  image_sha256: string;
  issued_at: string;
  verification_url: string;
  download_url: string;
  check_id: string;
  team_id: string | null;
  cached: boolean;
  model: DetectorModel;
  model_id: string;
};
export type HistoryItem = {
  id: string;
  image_name: string;
  file_name: string;
  image_sha256: string;
  model: DetectorModel;
  model_id: string;
  is_hot_dog: boolean;
  cached: boolean;
  created_at: string;
  certificate_id: string;
  size_bytes: number;
  content_type: string;
  user_id: string;
  team_id: string | null;
  user_display_name?: string;
  user_email?: string;
  review: HumanReview | null;
};
export type HistoryPage = {
  items: HistoryItem[];
  total: number;
  limit: number;
  offset: number;
};
export type ModelStats = {
  model: DetectorModel;
  checks: number;
  cache_hits: number;
  llm_calls: number;
  input_tokens: number;
  output_tokens: number;
};
export type UsageStats = {
  total_checks: number;
  hot_dogs: number;
  not_hot_dogs: number;
  cache_hits: number;
  llm_calls: number;
  input_tokens: number;
  output_tokens: number;
  models: ModelStats[];
};
type UploadTicket = {
  upload_id: string;
  url: string;
  fields: Record<string, string>;
};

async function accessToken() {
  const token = await getAccessToken();
  if (!token) throw new Error("Sign in to continue.");
  return token;
}
async function request<T>(
  path: string,
  init: RequestInit = {},
  authenticated = true,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (authenticated)
    headers.set("Authorization", `Bearer ${await accessToken()}`);
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      typeof data?.detail === "string"
        ? data.detail
        : "The request failed. Please try again.",
    );
  return data as T;
}
export async function checkPhoto(
  file: File,
  model: DetectorModel,
  onUploaded?: () => void,
): Promise<PhotoResult> {
  const signal = AbortSignal.timeout(90_000);
  const token = await accessToken();
  const post = <T>(path: string, body: object) =>
    request<T>(
      path,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal,
      },
      false,
    );
  const ticket = await post<UploadTicket>("/uploads", {
    content_type: file.type,
    size_bytes: file.size,
  });
  const form = new FormData();
  for (const [name, value] of Object.entries(ticket.fields))
    form.append(name, value);
  form.append("file", file);
  const upload = await fetch(ticket.url, {
    method: "POST",
    body: form,
    signal,
  });
  if (!upload.ok)
    throw new Error("The photo could not be uploaded. Please try again.");
  onUploaded?.();
  const result = await post<PhotoResult>("/classify", {
    upload_id: ticket.upload_id,
    model,
    file_name: file.name,
    image_name: file.name,
  });
  if (
    typeof result?.is_hot_dog !== "boolean" ||
    typeof result.certificate_id !== "string"
  )
    throw new Error("The check result could not be read. Please try again.");
  return result;
}
export type ActivityFilters = {
  user_id?: string;
  result?: string;
  verification?: string;
  model?: string;
};
function filterQuery(filters: ActivityFilters) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters))
    if (value) query.set(key, value);
  return query.toString();
}
export const getHistory = (
  offset: number,
  signal: AbortSignal,
  filters: ActivityFilters = {},
) =>
  request<HistoryPage>(
    `/history?limit=20&offset=${offset}&${filterQuery(filters)}`,
    { signal },
  );
export const getStats = (signal: AbortSignal, filters: ActivityFilters = {}) =>
  request<UsageStats>(`/stats?${filterQuery(filters)}`, { signal });
export const deleteAccountData = () =>
  request<{ deleted: boolean; cleanup_scheduled: boolean }>("/account/data", {
    method: "DELETE",
    body: JSON.stringify({ confirmation: "DELETE" }),
    signal: AbortSignal.timeout(60_000),
  });
export async function getCertificateDownload(certificateId: string) {
  const data = await request<{ url: string; expires_in: number }>(
    `/certificates/${encodeURIComponent(certificateId)}/download`,
    { signal: AbortSignal.timeout(20_000) },
    false,
  );
  const url = new URL(data.url);
  const loopbackHosts = ["localhost", "127.0.0.1"];
  const localHttp =
    url.protocol === "http:" &&
    loopbackHosts.includes(window.location.hostname) &&
    loopbackHosts.includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp)
    throw new Error("The certificate download link is invalid.");
  return url.href;
}

export type TeamRole = "admin" | "supervisor" | "user";
export const roleLabels: Record<TeamRole, string> = {
  admin: "Admin",
  supervisor: "Supervisor",
  user: "User",
};
export type TeamMember = {
  user_id: string;
  email?: string;
  display_name?: string;
  role: TeamRole;
};
export type TeamInvitation = { id: string; role: TeamRole; expires_at: string };
export type TeamState = {
  team: { id: string; name: string; role: TeamRole } | null;
  members: TeamMember[];
  invitations: TeamInvitation[];
};
export type HumanReview = {
  id: string;
  status: "pending" | "completed";
  is_hot_dog: boolean | null;
  certificate_id: string | null;
  reviewed_at: string | null;
  reviewer_name: string | null;
  reviewer_id: string | null;
};
export type ReviewItem = {
  id: string;
  check_id: string;
  image_name: string;
  file_name: string;
  image_sha256: string;
  model: string;
  original_is_hot_dog: boolean;
  created_at: string;
  submitter_name: string;
  image_url: string;
};
export type ReviewPage = {
  items: ReviewItem[];
  total: number;
  limit: number;
  offset: number;
};
export const getCurrentTeam = (signal?: AbortSignal) =>
  request<TeamState>("/teams/current", {
    signal: signal ?? AbortSignal.timeout(20_000),
  });
export const createTeam = (name: string) =>
  request<TeamState>("/teams", {
    method: "POST",
    body: JSON.stringify({ name }),
    signal: AbortSignal.timeout(20_000),
  });
export const createInvitation = (role: TeamRole) =>
  request<TeamInvitation & { code: string }>("/teams/invitations", {
    method: "POST",
    body: JSON.stringify({ role }),
    signal: AbortSignal.timeout(20_000),
  });
export const acceptInvitation = (code: string) =>
  request<TeamState>("/teams/invitations/accept", {
    method: "POST",
    body: JSON.stringify({ code }),
    signal: AbortSignal.timeout(20_000),
  });
export const changeMemberRole = (userId: string, role: TeamRole) =>
  request<TeamState>(`/teams/members/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
    signal: AbortSignal.timeout(20_000),
  });
export const escalateCheck = (checkId: string) =>
  request<HumanReview>(`/checks/${encodeURIComponent(checkId)}/escalate`, {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
  });
export const getReviews = (signal?: AbortSignal, offset = 0) =>
  request<ReviewPage>(`/reviews?limit=20&offset=${offset}`, {
    signal: signal ?? AbortSignal.timeout(20_000),
  });
export const decideReview = (reviewId: string, isHotDog: boolean) =>
  request<HumanReview>(`/reviews/${encodeURIComponent(reviewId)}/decision`, {
    method: "POST",
    body: JSON.stringify({ is_hot_dog: isHotDog }),
    signal: AbortSignal.timeout(30_000),
  });

export const removeTeamMember = (userId: string) =>
  request<TeamState>(`/teams/members/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    signal: AbortSignal.timeout(20_000),
  });
