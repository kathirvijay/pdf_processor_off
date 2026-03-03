/**
 * Save template to Waka integration (Step 4).
 * Sends template + token to backend; backend verifies token and forwards to Integration Service.
 */

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

/**
 * @param {string} token - JWT from Waka entry (useWakaEntry().token)
 * @param {object} templatePayload - Same shape as createTemplate: name, documentName, description, category, settings, pages, etc.
 * @returns {Promise<{ success: boolean, id?: string, error?: string }>}
 */
export async function saveToWaka(token, templatePayload) {
  if (!token) {
    return { success: false, error: 'No Waka token. Open this app from Waka Settings → Document templates.' };
  }
  try {
    const url = `${API_URL.replace(/\/$/, '')}/waka/save-template`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ token, ...templatePayload }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) return { success: true, id: data.id };
    return { success: false, error: data.error || data.message || 'Failed to save to Waka' };
  } catch (err) {
    return { success: false, error: err.message || 'Failed to save to Waka' };
  }
}
