import axios from 'axios';
import { getToken, removeToken } from './auth';

const api = axios.create({
  baseURL: window.location.origin,
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      removeToken();
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Auth
export function login(email: string, password: string) {
  return api.post('/api/auth/login', { email, password });
}

export function register(email: string, username: string, password: string, displayName: string) {
  return api.post('/api/auth/register', { email, username, password, display_name: displayName });
}

export function getMe() {
  return api.get('/api/auth/me');
}

// Collections
export function getCollections(search?: string) {
  const params: Record<string, string> = {};
  if (search) params.search = search;
  return api.get('/api/collections', { params });
}

export function createCollection(name: string, description?: string) {
  return api.post('/api/collections', { name, description });
}

export function getCollectionDetail(collectionId: string) {
  return api.get(`/api/collections/${collectionId}`);
}

export function updateCollection(collectionId: string, data: { name?: string; description?: string }) {
  return api.put(`/api/collections/${collectionId}`, data);
}

export function deleteCollection(collectionId: string) {
  return api.delete(`/api/collections/${collectionId}`);
}

export function getCollectionShareInfo(collectionId: string) {
  return api.get(`/api/collections/${collectionId}/share`);
}

export function shareCollection(collectionId: string, isPublic: boolean) {
  return api.post(`/api/collections/${collectionId}/share`, { is_public: isPublic });
}

export function addCollectionMember(collectionId: string, email: string, role: string = 'editor') {
  return api.post(`/api/collections/${collectionId}/members`, { email, role });
}

export function removeCollectionMember(collectionId: string, userId: string) {
  return api.delete(`/api/collections/${collectionId}/members/${userId}`);
}

export function searchUsers(query: string) {
  return api.get('/api/users/search', { params: { q: query } });
}

export function getCollectionByShareToken(shareToken: string) {
  return api.get(`/api/c/${shareToken}`);
}

// Boards
export function createBoard(collectionId: string, name: string, description?: string) {
  return api.post('/api/boards', { collection_id: collectionId, name, description });
}

export function getBoard(boardId: string) {
  return api.get(`/api/boards/${boardId}`);
}

export function updateBoard(boardId: string, data: { name?: string; description?: string }) {
  return api.put(`/api/boards/${boardId}`, data);
}

export function deleteBoard(boardId: string) {
  return api.delete(`/api/boards/${boardId}`);
}

export function saveCanvas(boardId: string, canvasState: string, thumbnail?: string) {
  return api.post(`/api/boards/${boardId}/save`, { canvas_state: canvasState, thumbnail });
}

export function uploadImage(boardId: string, file: File) {
  const formData = new FormData();
  formData.append('image', file);
  return api.post(`/api/upload/boards/${boardId}/images`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

export function uploadImageFromUrl(boardId: string, url: string) {
  return api.post(`/api/upload/boards/${boardId}/images/from-url`, { url });
}

export default api;
