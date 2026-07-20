export function validateProcessorEnvironment(environment = process.env) {
  if (typeof environment.OPENAI_API_KEY !== "string" || !environment.OPENAI_API_KEY.trim()) {
    throw new Error("OPENAI_API_KEY is missing. Add OPENAI_API_KEY=your_key_here to .env, then restart the processor.");
  }
}
