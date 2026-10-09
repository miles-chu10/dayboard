export async function withTimeout(operation, milliseconds, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds);
  });
  try {
    return await Promise.race([Promise.resolve().then(operation), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
