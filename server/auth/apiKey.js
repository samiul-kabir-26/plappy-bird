import { HttpError, safeEqual } from '../util.js';

export const requireApiKey = (cfg) => (req, res, next) => {
  const key = req.get('x-api-key');
  if (!key || !safeEqual(key, cfg.apiKey)) return next(new HttpError(401, 'unauthorized', 'Missing or invalid API key'));
  next();
};
