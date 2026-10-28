// Review is the default. Execution authorization is established by the calling agent.
export class ReviewComplete extends Error {
  constructor(review) {
    super("Review prepared");
    this.review = review;
  }
}
export let executionReview;
export async function confirm(review, execute) {
  if (!execute) throw new ReviewComplete(review);
  executionReview = review;
}
