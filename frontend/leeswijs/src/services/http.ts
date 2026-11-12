import axios from "axios";

import { useStore } from "../store";

const baseUrl =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  "http://localhost:8000/api";

export const apiClient = axios.create({
  baseURL: baseUrl,
  headers: { "Content-Type": "application/json" },
  timeout: 30_000,
});

export const readingGenerationTimeoutMs = 120_000;

apiClient.interceptors.request.use((config) => {
  const token = useStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      const url = error.config?.url ?? "";
      const isAuthCall = url.startsWith("/auth/");
      if (!isAuthCall && useStore.getState().token) {
        useStore.getState().clearUser();
        if (!window.location.pathname.startsWith("/login")) {
          window.location.assign("/login");
        }
      }
    }
    return Promise.reject(error);
  },
);

export function extractError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    if (err.code === "ECONNABORTED" || err.message.toLowerCase().includes("timeout")) {
      return "This is taking longer than expected. Please wait a moment and try again.";
    }
    if (!err.response) {
      return "Cannot reach the server. Please check that the backend is running.";
    }
    const detail = err.response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail.map((d) => (typeof d === "string" ? d : d.msg ?? JSON.stringify(d))).join("; ");
    }
    return err.message;
  }
  return err instanceof Error ? err.message : "An unexpected error occurred.";
}
