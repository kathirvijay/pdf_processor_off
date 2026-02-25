import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_URL,
});

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
