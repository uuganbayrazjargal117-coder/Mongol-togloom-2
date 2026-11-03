export async function loadAlagModel(setStage = () => {}, fetchModel = globalThis.fetch) {
  const url = new URL('./bone.json', import.meta.url);
  setStage('bone-fetch');
  const response = await fetchModel(url);
  if (!response.ok) throw new Error(`bone.json HTTP ${response.status}`);
  setStage('bone-json');
  const data = await response.json();
  if (!Array.isArray(data.vertices) || !data.vertices.length || !Array.isArray(data.faces) ||
      !Array.isArray(data.outline) || data.outline.length < 3 || !Number.isFinite(data.outlineY)) {
    throw new Error('bone.json is missing valid vertices, faces or outline data.');
  }
  return data;
}
