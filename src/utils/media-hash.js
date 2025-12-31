const crypto = require('crypto');
const { createLogger } = require('../utils');

const logger = createLogger('MediaHash');

async function createMediaHash(fileId, mediaType) {
  try {
    const data = `${fileId}_${mediaType}`;
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    return hash;
  } catch (error) {
    logger.error('Error creating media hash', { error: error.message, fileId });
    return null;
  }
}

async function createMediaHashFromBuffer(buffer) {
  try {
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    return hash;
  } catch (error) {
    logger.error('Error creating media hash from buffer', { error: error.message });
    return null;
  }
}

function generateMediaSignature(fileId, fileSize, mimeType) {
  const data = `${fileId}_${fileSize}_${mimeType || 'unknown'}`;
  return crypto.createHash('md5').update(data).digest('hex');
}

module.exports = {
  createMediaHash,
  createMediaHashFromBuffer,
  generateMediaSignature
};
