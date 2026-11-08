# NSFW model tooling

The scorer in `server/src/nsfw/` is the LAION CLIP-based NSFW detector for ViT-B/32
(`clip_autokeras_nsfw_b32.zip` from https://github.com/LAION-AI/CLIP-based-NSFW-Detector, MIT license):
Normalization → Dense 32 ReLU → Dense 32 ReLU → Dense 1 sigmoid, on L2-normalised CLIP embeddings.

Regenerate the weights module and the test fixture (numpy only, no TensorFlow):

```bash
mkdir -p /tmp/laion && cd /tmp/laion
curl -LO https://github.com/LAION-AI/CLIP-based-NSFW-Detector/raw/main/clip_autokeras_nsfw_b32.zip && unzip -o clip_autokeras_nsfw_b32.zip
cd -   # back to the repo root
python3 -I misc/nsfw/extract_weights.py /tmp/laion/clip_autokeras_nsfw_b32 /tmp/laion/w.npz
python3 -I misc/nsfw/make_fixture.py /tmp/laion/w.npz server/src/nsfw
(cd server && pnpm exec prettier --write src/nsfw)
```

The fixture vectors are synthetic (interpolations between a random vector and one pushed to score ~1),
never real user embeddings.
