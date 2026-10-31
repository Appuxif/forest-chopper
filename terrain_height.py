"""Deterministic server/headless mirror of src/terrain.js (heightfield v1).

Keep constants and operations identical when editing terrainHeight() in JS.
Legacy forest tree/resource IDs still depend only on (seed, x, z), not Y.
"""
import math

_MASK = 0xffffffff
_DENOMINATOR = 4294967295


def _lattice(ix, iz, seed, channel):
    h = (ix*374761393 + iz*668265263 + seed*1442695041
         + channel*1013904223) & _MASK
    h = ((h ^ (h >> 13))*1274126177) & _MASK
    return ((h ^ (h >> 16)) & _MASK) / _DENOMINATOR


def _noise(x, z, seed, channel):
    ix, iz = math.floor(x), math.floor(z)
    tx, tz = x-ix, z-iz
    tx, tz = tx*tx*(3-2*tx), tz*tz*(3-2*tz)
    a = _lattice(ix, iz, seed, channel)
    b = _lattice(ix+1, iz, seed, channel)
    c = _lattice(ix, iz+1, seed, channel)
    d = _lattice(ix+1, iz+1, seed, channel)
    return (a+(b-a)*tx)*(1-tz)+(c+(d-c)*tx)*tz


def base_height(seed, x, z):
    hills = (2*_noise(x/155, z/155, seed, 11)-1)*5.0
    rolls = (2*_noise(x/66, z/66, seed, 23)-1)*2.5
    detail = (2*_noise(x/30, z/30, seed, 37)-1)*.45
    basin = max(0, _noise(x/118, z/118, seed, 47)-.46)*6
    distance = math.hypot(x, z)
    fade = max(0, min(1, (distance-18)/70))
    fade = fade*fade*(3-2*fade)
    return fade*(hills+rolls+detail-basin)


def height_at(seed,x,z):
    from ponds import pond_height_at
    base=base_height(seed,x,z)
    return pond_height_at(seed,x,z,base)


def normal_at(seed, x, z):
    step = .75
    dx = (height_at(seed,x+step,z)-height_at(seed,x-step,z))/(2*step)
    dz = (height_at(seed,x,z+step)-height_at(seed,x,z-step))/(2*step)
    norm = math.sqrt(dx*dx+1+dz*dz)
    return (-dx/norm, 1/norm, -dz/norm)


def surface_at(seed, x, z):
    return 'ground'
