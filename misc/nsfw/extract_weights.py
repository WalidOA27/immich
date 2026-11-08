"""Extract LAION autokeras NSFW head weights from a TF checkpoint without TensorFlow.

Usage: python3 -I extract_weights.py <saved_model_dir> <out.npz>
"""
import struct
import sys

import numpy as np

DTYPES = {1: np.float32, 2: np.float64, 3: np.int32, 9: np.int64}


def varint(buf, pos):
    shift = result = 0
    while True:
        b = buf[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if not b & 0x80:
            return result, pos
        shift += 7


def block_entries(data, offset, size):
    block = data[offset:offset + size]
    assert data[offset + size] == 0, "compressed block not supported"
    num_restarts = struct.unpack_from("<I", block, len(block) - 4)[0]
    end = len(block) - 4 - 4 * num_restarts
    pos, key = 0, b""
    while pos < end:
        shared, pos = varint(block, pos)
        non_shared, pos = varint(block, pos)
        vlen, pos = varint(block, pos)
        key = key[:shared] + block[pos:pos + non_shared]
        pos += non_shared
        yield key, block[pos:pos + vlen]
        pos += vlen


def parse_entry(buf):
    """Minimal BundleEntryProto parser: dtype, shape, offset, size."""
    out = {"dtype": 0, "shape": [], "offset": 0, "size": 0}
    pos = 0
    while pos < len(buf):
        tag, pos = varint(buf, pos)
        field, wire = tag >> 3, tag & 7
        if wire == 0:
            val, pos = varint(buf, pos)
            if field == 1:
                out["dtype"] = val
            elif field == 4:
                out["offset"] = val
            elif field == 5:
                out["size"] = val
        elif wire == 2:
            ln, pos = varint(buf, pos)
            sub = buf[pos:pos + ln]
            pos += ln
            if field == 2:  # TensorShapeProto
                p = 0
                while p < len(sub):
                    t, p = varint(sub, p)
                    ln2, p = varint(sub, p)
                    dim = sub[p:p + ln2]
                    p += ln2
                    if t >> 3 == 2:
                        q, size = 0, 0
                        while q < len(dim):
                            t2, q = varint(dim, q)
                            if t2 & 7 == 0:
                                v, q = varint(dim, q)
                                if t2 >> 3 == 1:
                                    size = v
                            else:
                                l3, q = varint(dim, q)
                                q += l3
                        out["shape"].append(size)
        elif wire == 5:
            pos += 4
        elif wire == 1:
            pos += 8
    return out


def main(model_dir, out_path):
    index = open(f"{model_dir}/variables/variables.index", "rb").read()
    data = open(f"{model_dir}/variables/variables.data-00000-of-00001", "rb").read()
    footer = index[-48:]
    p = 0
    _, p = varint(footer, p)
    _, p = varint(footer, p)
    idx_off, p = varint(footer, p)
    idx_size, p = varint(footer, p)
    tensors = {}
    for _, handle in block_entries(index, idx_off, idx_size):
        off, q = varint(handle, 0)
        size, _ = varint(handle, q)
        for key, value in block_entries(index, off, size):
            name = key.decode(errors="replace")
            if not name.endswith("VARIABLE_VALUE") or "metrics" in name or "optimizer" in name:
                continue
            e = parse_entry(value)
            if e["dtype"] not in DTYPES:
                continue
            arr = np.frombuffer(data[e["offset"]:e["offset"] + e["size"]], dtype=DTYPES[e["dtype"]])
            tensors[name] = arr.reshape(e["shape"]) if e["shape"] else arr
    for k, v in tensors.items():
        print(k, v.shape, v.dtype)
    np.savez(out_path, **{k.replace("/", "|"): v for k, v in tensors.items()})


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
