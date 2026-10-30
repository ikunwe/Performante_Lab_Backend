const { createHash } = require('node:crypto');
const key = value => String(value).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function normalizeModels(brandId, models, sourceUrl) {
  const names = new Set();
  return models.map(model => {
    if (typeof model.name !== 'string' || !model.name.trim()) throw new Error('Invalid model name');
    const name = model.name.trim();
    if (names.has(name.toLowerCase())) throw new Error('Duplicate model: ' + name);
    names.add(name.toLowerCase());
    return {
      id: brandId + ':' + key(name) + ':' + createHash('sha256').update(name).digest('hex').slice(0, 8),
      brandId, name, sourceUrl: model.sourceUrl || sourceUrl,
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'en'));
}
module.exports = { normalizeModels };
