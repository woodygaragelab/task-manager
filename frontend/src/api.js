import { fetchAuthSession } from "aws-amplify/auth";
import { API_BASE_URL } from "./config";

async function authHeader() {
  const session = await fetchAuthSession();
  const idToken = session.tokens?.idToken?.toString();
  if (!idToken) {
    throw new Error("認証セッションが切れています。再度ログインしてください。");
  }
  return { Authorization: `Bearer ${idToken}` };
}

async function request(path, { method = "GET", body } = {}) {
  const headers = {
    ...(await authHeader()),
    "Content-Type": "application/json; charset=utf-8",
  };

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    // JSON.stringify はUTF-8文字列を返すため、fetchは正しくUTF-8バイト列として送信する
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message = data?.error || `リクエストに失敗しました(${res.status})`;
    throw new Error(message);
  }
  return data;
}

export const api = {
  searchCustomers: (prefix) =>
    request(`/customers?prefix=${encodeURIComponent(prefix)}`),

  listTasksByCustomer: (customerName) =>
    request(`/customers/${encodeURIComponent(customerName)}/tasks`),

  getTask: (taskId) => request(`/tasks/${taskId}`),

  createTask: (task) => request(`/tasks`, { method: "POST", body: task }),

  updateTask: (taskId, patch) =>
    request(`/tasks/${taskId}`, { method: "PATCH", body: patch }),

  linkEmail: (taskId, threadId) =>
    request(`/tasks/${taskId}/emails`, {
      method: "POST",
      body: { threadId },
    }),
};
