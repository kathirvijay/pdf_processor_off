import axios from 'axios';
import logger from '../utils/logger';

const API_URL = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL: API_URL,
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    logger.apiError({ service: 'csv', url: err.config?.url, method: err.config?.method }, err);
    return Promise.reject(err);
  }
);

export const csvService = {
  importStructure: async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return await api.post('/csv/import-structure', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  validate: async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return await api.post('/csv/validate', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

export default csvService;
