let modelsReady = false;

const setModelsReady = (ready) => {
  modelsReady = ready;
};

const ensureModelsReady = (req, res, next) => {
  if (!modelsReady) {
    return res.status(503).json({ message: 'Service initializing, please try again' });
  }
  next();
};

module.exports = { ensureModelsReady, setModelsReady };
