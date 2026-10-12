import { validate, compare } from './engine.js';
self.onmessage = ({data}) => {
  const {id, mode, left, right} = data;
  try {
    const result = mode === 'compare' ? compare(left, right) : validate(left, right);
    self.postMessage({id, result});
  } catch (error) {
    self.postMessage({id, error: error instanceof Error ? error.message : String(error)});
  }
};
