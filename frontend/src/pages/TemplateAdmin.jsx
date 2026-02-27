import React, { useState, useEffect, useRef } from 'react';
import { standardizedTemplateService, templateDesignService } from '../services/templateService';
import pdfService from '../services/pdfService';
import { boxesToLayoutOnly } from '../utils/designUtils';
import DesignThumbnail from '../components/DesignThumbnail';
import './TemplateAdmin.css';

const sortKvByKey = (a, b) => {
  const ak = String(a?.key ?? '').trim().toLowerCase();
  const bk = String(b?.key ?? '').trim().toLowerCase();
  if (!ak && !bk) return 0;
  if (!ak) return -1; /* empty key (e.g. new row) at top */
  if (!bk) return 1;
  return ak.localeCompare(bk);
};

const TemplateAdmin = () => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formatName, setFormatName] = useState('');
  const [designName, setDesignName] = useState('');
  const [keyValuePairs, setKeyValuePairs] = useState([]);
  const [boxes, setBoxes] = useState([]);
  const [templateDesignsList, setTemplateDesignsList] = useState([]);
  const [standardizedFormats, setStandardizedFormats] = useState([]);
  const [selectedDesignId, setSelectedDesignId] = useState(null);
  const [selectedFormatId, setSelectedFormatId] = useState(null);
  const [formatKeyValuePairs, setFormatKeyValuePairs] = useState([]);
  const [message, setMessage] = useState('');
  const [saveFeedback, setSaveFeedback] = useState(null); // { type: 'format'|'design', success: boolean, message: string }
  const [designRecommendFormatId, setDesignRecommendFormatId] = useState(null);
  const [selectedBoxId, setSelectedBoxId] = useState(null);
  const [editingFormatId, setEditingFormatId] = useState(null);
  const [editKeyValuePairs, setEditKeyValuePairs] = useState([]);
  const [savingFormat, setSavingFormat] = useState(false);
  const [highlightedEditRowKey, setHighlightedEditRowKey] = useState(null);

  const fetchDesigns = () => {
    templateDesignService.list()
      .then((r) => setTemplateDesignsList(Array.isArray(r.data) ? r.data : []))
      .catch(() => setTemplateDesignsList([]));
  };

  const fetchFormats = () => {
    standardizedTemplateService.list()
      .then((r) => setStandardizedFormats(Array.isArray(r.data) ? r.data : []))
      .catch(() => setStandardizedFormats([]));
  };

  useEffect(() => {
    fetchDesigns();
    fetchFormats();
  }, []);

  useEffect(() => {
    if (!selectedFormatId) {
      setFormatKeyValuePairs([]);
      return;
    }
    standardizedTemplateService.getById(selectedFormatId)
      .then((r) => setFormatKeyValuePairs(Array.isArray(r.data?.keyValuePairs) ? r.data.keyValuePairs : []))
      .catch(() => setFormatKeyValuePairs([]));
  }, [selectedFormatId]);

  const editTableWrapRef = useRef(null);
  useEffect(() => {
    if (!highlightedEditRowKey || !editingFormatId || !editTableWrapRef.current) return;
    const row = editTableWrapRef.current.querySelector(`tr[data-row-key="${CSS.escape(highlightedEditRowKey)}"]`);
    if (row) {
      row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const input = row.querySelector('input');
      if (input) input.focus();
    }
  }, [highlightedEditRowKey, editingFormatId]);

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setLoading(true);
      setMessage('');
      setSaveFeedback(null);
      const data = await pdfService.importTemplate(file);
      const list = data?.boxes || [];
      const pairs = [];
      const seen = new Set();
      for (const box of list) {
        const key = (box.fieldName || box.labelName || '').trim() || null;
        if (!key || seen.has(key.toLowerCase())) continue;
        seen.add(key.toLowerCase());
        pairs.push({
          key,
          label: (box.labelName || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())).trim(),
        });
      }
      setKeyValuePairs(pairs.length ? pairs : [{ key: '', label: '' }]);
      setBoxes(list.map((b) => ({
        ...b,
        id: b.id || `box_${Math.random().toString(36).slice(2)}`,
        position: b.position || { x: 0, y: 0 },
        size: b.size || { width: 120, height: 20 },
      })));
      const pdfBaseName = (file.name || '').replace(/\.pdf$/i, '').trim() || 'document';
      const nameFromPdf = pdfBaseName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      // Prefer template name from document; if API returns the generic fallback, use uploaded file name
      const apiName = (data?.templateName || '').trim();
      const isGenericFallback = !apiName || apiName === 'Imported from PDF';
      setFormatName(isGenericFallback ? nameFromPdf : apiName);
      setDesignName(`${nameFromPdf} template`);
      setMessage(`Imported ${list.length} boxes, ${pairs.length} key-value pairs. Edit and save as format or design.`);
    } catch (err) {
      setMessage(err.response?.data?.message || err.message || 'Upload failed');
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  };

  const addKeyValueRow = () => {
    setKeyValuePairs((p) => [{ key: '', label: '' }, ...p]);
  };

  const updateKeyValue = (index, field, value) => {
    setKeyValuePairs((p) => {
      const next = [...p];
      if (!next[index]) next[index] = { key: '', label: '' };
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const removeKeyValue = (index) => {
    setKeyValuePairs((p) => p.filter((_, i) => i !== index));
  };

  const openEditFormat = (format) => {
    if (!format) return;
    setSelectedFormatId(format.id);
    const pairs = Array.isArray(format.keyValuePairs) ? format.keyValuePairs : [];
    setEditKeyValuePairs(pairs.length ? pairs.map((p) => ({ key: p.key || '', label: p.label ?? p.key ?? '' })) : [{ key: '', label: '' }]);
    setEditingFormatId(format.id);
    setHighlightedEditRowKey(null);
  };

  const closeEditFormat = () => {
    setEditingFormatId(null);
    setEditKeyValuePairs([]);
    setHighlightedEditRowKey(null);
  };

  const updateEditKeyValue = (index, field, value) => {
    setEditKeyValuePairs((p) => {
      const next = [...p];
      if (!next[index]) next[index] = { key: '', label: '' };
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const addEditKeyValueRow = () => {
    setEditKeyValuePairs((p) => [{ key: '', label: '' }, ...p]);
  };

  const removeEditKeyValueRow = (index) => {
    setEditKeyValuePairs((p) => p.filter((_, i) => i !== index));
  };

  const handleSaveFormatEdits = async () => {
    if (!editingFormatId) return;
    const pairs = editKeyValuePairs
      .map((p) => ({ key: String(p?.key ?? '').trim(), label: String(p?.label ?? p?.key ?? '').trim() }))
      .filter((p) => p.key);
    if (!pairs.length) {
      setMessage('Add at least one key-value pair');
      return;
    }
    try {
      setSavingFormat(true);
      setMessage('');
      await standardizedTemplateService.update(editingFormatId, { keyValuePairs: pairs });
      setMessage('Format key-value pairs updated.');
      fetchFormats();
      if (selectedFormatId === editingFormatId) {
        setFormatKeyValuePairs(pairs);
      }
      closeEditFormat();
    } catch (err) {
      setMessage(err.response?.data?.message || err.message || 'Update failed');
    } finally {
      setSavingFormat(false);
    }
  };

  const handleSaveAsFormat = async () => {
    const name = formatName.trim();
    if (!name) {
      setMessage('Format name is required');
      setSaveFeedback(null);
      return;
    }
    const pairs = keyValuePairs
      .map((p) => ({ key: String(p?.key ?? '').trim(), label: String(p?.label ?? p?.key ?? '').trim() }))
      .filter((p) => p.key);
    if (!pairs.length) {
      setMessage('Add at least one key-value pair');
      setSaveFeedback(null);
      return;
    }
    try {
      setSaving(true);
      setMessage('');
      setSaveFeedback(null);
      await standardizedTemplateService.create({ name, slug: name.toLowerCase().replace(/\s+/g, '-'), keyValuePairs: pairs });
      const msg = 'Standardized format saved successfully.';
      setMessage(msg);
      setSaveFeedback({ type: 'format', success: true, message: msg });
      fetchFormats();
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Save failed';
      setMessage(msg);
      setSaveFeedback({ type: 'format', success: false, message: msg });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAsDesign = async () => {
    const name = designName.trim() || 'Untitled design';
    if (!boxes.length) {
      setMessage('Upload a template first to save as design');
      setSaveFeedback(null);
      return;
    }
    try {
      setSaving(true);
      setMessage('');
      setSaveFeedback(null);
      const layoutOnly = boxesToLayoutOnly(boxes);
      const linkedFormatId = designRecommendFormatId || selectedFormatId || null;
      await templateDesignService.create({
        name,
        standardizedTemplateId: linkedFormatId,
        design: { pages: [{ pageNumber: 1, boxes: layoutOnly }] },
        settings: { pageSize: 'A4', orientation: 'portrait' },
      });
      const msg = 'Template design saved successfully. It appears in the list on the right.';
      setMessage(msg);
      setSaveFeedback({ type: 'design', success: true, message: msg });
      fetchDesigns();
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Save failed';
      setMessage(msg);
      setSaveFeedback({ type: 'design', success: false, message: msg });
    } finally {
      setSaving(false);
    }
  };

  const handleLoadDesign = async (id) => {
    try {
      setLoading(true);
      const res = await templateDesignService.getById(id);
      const d = res.data;
      if (d?.design?.pages?.[0]?.boxes) {
        const defaultProps = { fontSize: 12, fontFamily: 'Arial', fontWeight: 'normal', fontColor: '#000000', backgroundColor: 'transparent', alignment: 'left', contentPosition: { x: 0, y: 0 }, border: true };
        setBoxes(d.design.pages[0].boxes.map((b) => ({
          id: b.id || `box_${Math.random().toString(36).slice(2)}`,
          position: b.position || { x: 0, y: 0 },
          size: b.size || { width: 120, height: 20 },
          type: b.type || 'text',
          rank: b.rank ?? 0,
          ...(b.type === 'table' && b.tableConfig ? { tableConfig: b.tableConfig } : {}),
          fieldName: '',
          labelName: '',
          content: '',
          properties: { ...defaultProps, contentPosition: { x: 0, y: 0 } },
        })));
        setSelectedDesignId(id);
        setSelectedBoxId(null);
        setMessage('Design loaded (empty boxes). Click a box, then click a key to map.');
      }
    } catch (err) {
      setMessage(err.response?.data?.message || err.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  };

  const setBoxFieldName = (boxId, key) => {
    if (!boxId) return;
    const kv = formatKeyValuePairs.find((p) => p.key === key);
    const label = kv?.label || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    setBoxes((p) => p.map((b) => (b.id === boxId ? { ...b, fieldName: key, labelName: label, content: `{{${key}}}` } : b)));
  };

  const removeBox = (boxId) => {
    setBoxes((p) => p.filter((b) => b.id !== boxId));
    if (selectedBoxId === boxId) setSelectedBoxId(null);
  };

  const handleUpdateDesign = async () => {
    if (!selectedDesignId || !boxes.length) {
      setMessage('Load a design first');
      return;
    }
    try {
      setSaving(true);
      setMessage('');
      const layoutOnly = boxesToLayoutOnly(boxes);
      await templateDesignService.update(selectedDesignId, {
        design: { pages: [{ pageNumber: 1, boxes: layoutOnly }] },
      });
      setMessage('Design updated with key mappings.');
    } catch (err) {
      setMessage(err.response?.data?.message || err.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const hasUploadData = keyValuePairs.length > 0 || boxes.length > 0;

  return (
    <div className="admin-container">
        <header className="admin-header">
        <h1>Admin – Standardized formats &amp; template designs</h1>
        {message && <p className="admin-message">{message}</p>}
      </header>

      <div className={`admin-content ${hasUploadData ? 'admin-content-after-upload' : ''}`}>
        <section className={`admin-left ${hasUploadData ? 'admin-left-expanded' : ''}`}>
          <div className="admin-card">
            <h2>Upload template</h2>
            <p className="admin-hint">Upload a PDF to extract key-value pairs and box layout. After upload, key-value pairs and save options expand here.</p>
            <label className="admin-file-label">
              <input type="file" accept=".pdf,application/pdf" onChange={handleFileUpload} disabled={loading} />
              <span className="admin-file-btn">{loading ? 'Uploading…' : 'Choose PDF'}</span>
            </label>
          </div>

          {hasUploadData && (
            <>
              <div className="admin-card">
                <h2>Standardized industry name</h2>
                <p className="admin-hint">Key-value pairs from the uploaded template. Key on the left (e.g. description_of_goods), value on the right (e.g. Description of goods). Edit and use below to save as standardized format.</p>
                <div className="admin-kv-toolbar">
                  <button
                    type="button"
                    className="admin-btn admin-btn-secondary"
                    onClick={addKeyValueRow}
                    disabled={keyValuePairs.some((kv) => !String(kv?.key ?? '').trim())}
                    title={keyValuePairs.some((kv) => !String(kv?.key ?? '').trim()) ? 'Fill in the key of the empty row before adding another' : 'Add a new row'}
                  >
                    + Add row
                  </button>
                </div>
                <div className="admin-kv-table-wrap">
                  <table className="admin-kv-table">
                    <thead>
                      <tr>
                        <th><strong>Key</strong></th>
                        <th><strong>Value</strong></th>
                        <th className="admin-kv-table-actions" aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {(keyValuePairs.length ? keyValuePairs : [{ key: '', label: '' }])
                        .map((kv, i) => ({ ...kv, _idx: i }))
                        .sort((a, b) => sortKvByKey(a, b))
                        .map((kv) => (
                        <tr key={kv._idx}>
                          <td>
                            <input
                              type="text"
                              value={kv.key}
                              onChange={(e) => updateKeyValue(kv._idx, 'key', e.target.value)}
                              placeholder="e.g. description_of_goods"
                              className="admin-kv-input"
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={kv.label}
                              onChange={(e) => updateKeyValue(kv._idx, 'label', e.target.value)}
                              placeholder="e.g. Description of goods"
                              className="admin-kv-input"
                            />
                          </td>
                          <td className="admin-kv-table-actions">
                            <button type="button" className="admin-btn admin-btn-small" onClick={() => removeKeyValue(kv._idx)} aria-label="Remove row">×</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="admin-card">
                <h2>Save as standardized format</h2>
                <p className="admin-hint">Format name is extracted from the uploaded template. Edit if needed.</p>
                <label className="admin-label">Standardized format name (from uploaded template)</label>
                <input
                  type="text"
                  value={formatName}
                  onChange={(e) => setFormatName(e.target.value)}
                  placeholder="e.g. Certificate of Origin"
                  className="admin-input"
                />
                <button type="button" className="admin-btn admin-btn-primary" onClick={handleSaveAsFormat} disabled={saving}>
                  {saving ? 'Saving…' : 'Save as format'}
                </button>
                {saveFeedback?.type === 'format' && (
                  <p className={`admin-save-feedback ${saveFeedback.success ? 'admin-save-feedback-success' : 'admin-save-feedback-error'}`}>
                    {saveFeedback.message}
                  </p>
                )}
              </div>

              <div className="admin-card">
                <h2>Save as template design (standardized)</h2>
                <p className="admin-hint">Layout only. Design name is pre-filled from PDF name. Link to a format to recommend in the editor.</p>
                <input
                  type="text"
                  value={designName}
                  onChange={(e) => setDesignName(e.target.value)}
                  placeholder="Design name (PDF name + template)"
                  className="admin-input"
                />
                <label className="admin-label">Recommend for format</label>
                <select
                  value={designRecommendFormatId || ''}
                  onChange={(e) => setDesignRecommendFormatId(e.target.value || null)}
                  className="admin-input"
                >
                  <option value="">— Select format —</option>
                  {[...standardizedFormats].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
                <button type="button" className="admin-btn admin-btn-primary" onClick={handleSaveAsDesign} disabled={saving || !boxes.length}>
                  {saving ? 'Saving…' : 'Save as design'}
                </button>
                {saveFeedback?.type === 'design' && (
                  <p className={`admin-save-feedback ${saveFeedback.success ? 'admin-save-feedback-success' : 'admin-save-feedback-error'}`}>
                    {saveFeedback.message}
                  </p>
                )}
              </div>
            </>
          )}
        </section>

        {!hasUploadData && (
        <section className="admin-middle">
          <div className="admin-card">
            <h2>Standardized formats</h2>
            <p className="admin-hint">Click a format to see its key-value pairs. Click a key to map it to the selected box.</p>
            <div className="admin-formats-list">
              {standardizedFormats.length === 0 ? (
                <p className="admin-muted">No formats yet. Upload a PDF on the left and save as format.</p>
              ) : (
                [...standardizedFormats].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map((st) => (
                  <div
                    key={st.id}
                    className={`admin-format-item ${selectedFormatId === st.id ? 'selected' : ''}`}
                    onClick={() => setSelectedFormatId(st.id)}
                  >
                    <span className="admin-format-item-name">{st.name}</span>
                    <button
                      type="button"
                      className="admin-format-item-edit"
                      onClick={(e) => { e.stopPropagation(); openEditFormat(st); }}
                      title="Edit key-value pairs"
                      aria-label="Edit key-value pairs"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {formatKeyValuePairs.length > 0 && !editingFormatId && (
            <div className="admin-card">
              <h2>Key-value pairs – click to map to selected box</h2>
              <p className="admin-hint">Select a box in the list below, then click a key here to assign it to that box.</p>
              <div className="admin-format-keys-list admin-format-keys-clickable">
                {[...formatKeyValuePairs].sort(sortKvByKey).map((kv, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="admin-format-key-item admin-format-key-btn"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (selectedBoxId) {
                        setBoxFieldName(selectedBoxId, kv.key);
                        setMessage(`Mapped "${kv.label || kv.key}" to box.`);
                      } else {
                        setMessage('Select a box in the list below first, then click a key.');
                      }
                    }}
                    title={selectedBoxId ? `Map "${kv.label || kv.key}" to selected box` : 'Select a box first'}
                  >
                    <span className="key">{kv.key}</span>
                    <span className="label">{kv.label || kv.key}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {editingFormatId && (
            <div className="admin-card admin-card-edit-format">
              <h2>Edit key-value pairs</h2>
              <p className="admin-hint">
                {standardizedFormats.find((f) => f.id === editingFormatId)?.name || 'This format'}. Change keys/values below and add new rows. Save to update the format.
              </p>
              <div className="admin-kv-toolbar">
                <button
                  type="button"
                  className="admin-btn admin-btn-secondary"
                  onClick={addEditKeyValueRow}
                  disabled={editKeyValuePairs.some((kv) => !String(kv?.key ?? '').trim())}
                  title={editKeyValuePairs.some((kv) => !String(kv?.key ?? '').trim()) ? 'Fill in the key of the empty row before adding another' : 'Add a new row'}
                >
                  + Add row
                </button>
              </div>
              <div className="admin-kv-table-wrap" ref={editTableWrapRef}>
                <table className="admin-kv-table">
                  <thead>
                    <tr>
                      <th><strong>Key</strong></th>
                      <th><strong>Value</strong></th>
                      <th className="admin-kv-table-actions" aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {(editKeyValuePairs.length ? editKeyValuePairs : [{ key: '', label: '' }])
                      .map((kv, i) => ({ ...kv, _idx: i }))
                      .sort((a, b) => sortKvByKey(a, b))
                      .map((kv) => (
                      <tr key={kv._idx} data-row-key={kv.key || `row-${kv._idx}`} className={highlightedEditRowKey === kv.key ? 'admin-edit-row-highlight' : ''}>
                        <td>
                          <input
                            type="text"
                            value={kv.key}
                            onChange={(e) => updateEditKeyValue(kv._idx, 'key', e.target.value)}
                            placeholder="e.g. description_of_goods"
                            className="admin-kv-input"
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            value={kv.label}
                            onChange={(e) => updateEditKeyValue(kv._idx, 'label', e.target.value)}
                            placeholder="e.g. Description of goods"
                            className="admin-kv-input"
                          />
                        </td>
                        <td className="admin-kv-table-actions">
                          <button type="button" className="admin-btn admin-btn-small" onClick={() => removeEditKeyValueRow(kv._idx)} aria-label="Remove row">×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="admin-edit-format-actions">
                <button type="button" className="admin-btn admin-btn-primary" onClick={handleSaveFormatEdits} disabled={savingFormat}>
                  {savingFormat ? 'Saving…' : 'Save changes'}
                </button>
                <button type="button" className="admin-btn admin-btn-secondary" onClick={closeEditFormat} disabled={savingFormat}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {boxes.length > 0 && (
            <div className="admin-card">
              <h2>Boxes – map to key</h2>
              <p className="admin-hint">Click a box row to select it (highlighted), then click a key above to map to that box. Use × to remove a box.</p>
              {selectedBoxId && (
                <p className="admin-hint" style={{ marginBottom: 8, color: 'var(--color-primary)' }}>
                  Selected: Box {boxes.findIndex((b) => b.id === selectedBoxId) + 1}
                  {boxes.find((b) => b.id === selectedBoxId)?.fieldName ? ` → ${boxes.find((b) => b.id === selectedBoxId).fieldName}` : ''}
                </p>
              )}
              <button type="button" className="admin-btn admin-btn-primary" onClick={handleUpdateDesign} disabled={saving} style={{ marginBottom: 10 }}>
                {saving ? 'Saving…' : 'Update design'}
              </button>
              <div className="admin-boxes-list">
                {[...boxes]
                  .sort((a, b) => {
                    const rankA = a.rank ?? 999999;
                    const rankB = b.rank ?? 999999;
                    if (rankA !== rankB) return rankA - rankB;
                    const yA = a.position?.y ?? 0;
                    const yB = b.position?.y ?? 0;
                    if (yA !== yB) return yA - yB;
                    return (a.position?.x ?? 0) - (b.position?.x ?? 0);
                  })
                  .map((box) => (
                  <div
                    key={box.id}
                    className={`admin-box-row ${selectedBoxId === box.id ? 'selected' : ''}`}
                    onClick={() => setSelectedBoxId(box.id)}
                  >
                    <span className="admin-box-label">
                      Box {(boxes.findIndex((x) => x.id === box.id) + 1)}
                      {box.fieldName ? ` → ${box.fieldName}` : ''}
                    </span>
                    {formatKeyValuePairs.length > 0 ? (
                      <select
                        value={box.fieldName || ''}
                        onChange={(e) => setBoxFieldName(box.id, e.target.value)}
                        className="admin-select"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <option value="">— Select key —</option>
                        {[...formatKeyValuePairs].sort(sortKvByKey).map((kv) => (
                          <option key={kv.key} value={kv.key}>{kv.label || kv.key}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="admin-muted">Select a format above</span>
                    )}
                    <button
                      type="button"
                      className="admin-btn admin-btn-delete"
                      onClick={(e) => { e.stopPropagation(); removeBox(box.id); }}
                      title="Remove box"
                      aria-label="Remove box"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
        )}

        <section className="admin-right">
          <div className="admin-card">
            <h2>Template designs</h2>
            <p className="admin-hint">Select a design to load. After uploading a PDF, use the left area to edit key-value pairs and save as format or design.</p>
            <div className="admin-designs-list admin-designs-list-thumbs">
              {templateDesignsList.length === 0 ? (
                <p className="admin-muted">No designs yet. Upload a PDF and save as design.</p>
              ) : (
                [...templateDesignsList].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map((td) => (
                  <div
                    key={td.id}
                    className={`admin-design-item admin-design-item-thumb ${selectedDesignId === td.id ? 'selected' : ''}`}
                    onClick={() => handleLoadDesign(td.id)}
                  >
                    <DesignThumbnail design={td} />
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default TemplateAdmin;
