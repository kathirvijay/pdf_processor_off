import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const pdfApi = axios.create({
  baseURL: API_URL,
  responseType: 'blob',
  headers: { 'Content-Type': 'application/json' },
});

const apiJson = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

export const pdfService = {
  generate: async (templateId, data = {}) => {
    const response = await pdfApi.post('/pdf/generate', { templateId, data });
    if (response.data instanceof Blob && response.data.type === 'application/json') {
      const text = await response.data.text();
      const error = JSON.parse(text);
      throw new Error(error.message || 'Failed to generate PDF');
    }
    return response;
  },

  /** Upload a PDF template and convert to HTML template structure (boxes). */
  importTemplate: async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await apiJson.post('/pdf/import-template', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  },
};

export default pdfService;
