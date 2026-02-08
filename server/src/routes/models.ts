import { Router } from 'express';
import { getAvailableModels, getDefaultProvider } from '../ai/models';

const router = Router();

router.get('/', (req, res) => {
  const models = getAvailableModels();
  const defaultProvider = getDefaultProvider();
  
  res.json({
    models,
    defaultProvider,
  });
});

export default router;
