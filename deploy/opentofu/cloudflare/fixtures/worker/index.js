export default {
  fetch() {
    return new Response("takos plan fixture", {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};
