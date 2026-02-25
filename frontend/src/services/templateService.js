import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

export const templateService = {
  getTemplates: async () => {
    const res = await api.get('/templates/list');
    return res;
  },

  getTemplate: async (id) => {
    const res = await api.get(`/templates/${id}`);
    return res;
  },

  createTemplate: async (templateData) => {
    const res = await api.post('/templates', templateData);
    return res;
  },

  updateTemplate: async (id, templateData) => {
    const res = await api.put(`/templates/${id}`, templateData);
    return res;
  },

  deleteTemplate: async (id) => {
    const res = await api.delete(`/templates/${id}`);
    return res;
  },
};

export const standardizedTemplateService = {
  list: () => api.get('/standardized-templates'),
  getById: (id) => api.get(`/standardized-templates/${id}`),
  create: (data) => api.post('/standardized-templates', data),
  update: (id, data) => api.put(`/standardized-templates/${id}`, data),
};

export const templateDesignService = {
  list: () => api.get('/template-designs'),
  getById: (id) => api.get(`/template-designs/${id}`),
  create: (data) => api.post('/template-designs', data),
  update: (id, data) => api.put(`/template-designs/${id}`, data),
  delete: (id) => api.delete(`/template-designs/${id}`),
};

export default templateService;
