// Next.js request APIs are not available to the answer-key runner; the engine code it runs never calls them.
const no = (name) => () => { throw new Error(`${name} is not available in the answer-key runner`); };
export const cookies = no("cookies"), headers = no("headers"), revalidatePath = no("revalidatePath"), revalidateTag = no("revalidateTag"),
  redirect = no("redirect"), notFound = no("notFound"), unstable_cache = (f) => f;
export default {};
