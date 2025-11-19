import numpy as np
import yaml
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import List, Dict, Any

"""
crystal_scene.py
================

This module encapsulates the configuration and geometry routines for the
Crystal Designer prototype.  It defines simple dataclasses for the
background (``SeaConfig``) and the embedded island (``IslandConfig``), along
with ``FacetConfig`` to describe plane cuts.  Configuration is stored in a
YAML file located next to this module (``design.yaml``) and loaded/saved
through ``load_config`` and ``save_config``.

The core function here is ``generate_atoms`` which builds a simple cubic
lattice for the sea and carves out a convex polyhedral island by
intersecting half‑spaces defined by Miller indices and offsets.  If no
facets are defined the island falls back to a spherical inclusion.  The
function returns a list of atoms with a ``type`` flag indicating whether
the atom belongs to the island or the matrix.

This file is intentionally lightweight and pure Python/NumPy.  It can be
imported both by the backend API and by test scripts without pulling in
any web or UI code.
"""

# Path to the YAML configuration
CONFIG_PATH = Path(__file__).parent / "design.yaml"


@dataclass
class SeaConfig:
    """Configuration for the host crystal (the "sea")."""

    lattice_constant: float = 5.43
    supercell: List[int] = None  # [na, nb, nc]

    def __post_init__(self) -> None:
        # Default supercell dimensions if not provided
        if self.supercell is None:
            self.supercell = [6, 6, 6]


@dataclass
class FacetConfig:
    """A single plane facet used to bound the island.

    Parameters
    ----------
    frame : str
        Frame in which Miller indices are expressed.  Currently only
        ``"sea"`` is used.
    miller : List[int]
        Three integers [h, k, l] giving the Miller indices.  A zero vector
        is ignored.
    offset : float
        Signed distance from the island centre along the facet normal (Å).
    side : str
        Which side of the plane is considered "inside" the island.  Either
        ``"inside"`` (points with ``n·(r−c) ≤ offset``) or ``"outside"``.
    """

    frame: str = "sea"
    miller: List[int] = None
    offset: float = 8.0
    side: str = "inside"

    def __post_init__(self) -> None:
        # Default Miller direction
        if self.miller is None:
            self.miller = [1, 1, 1]
        # Normalise side and frame values
        if self.side not in ("inside", "outside"):
            self.side = "inside"
        if self.frame not in ("sea", "island"):
            self.frame = "sea"


@dataclass
class IslandConfig:
    """Configuration for the embedded island."""

    enabled: bool = True
    center: List[float] = None  # [x, y, z] in Å (sea frame)
    radius: float = 8.0         # used as bounding sphere or fallback
    facets: List[FacetConfig] = field(default_factory=list)

    def __post_init__(self) -> None:
        # Default island centre at origin (later auto‑centred by generator)
        if self.center is None:
            self.center = [0.0, 0.0, 0.0]


@dataclass
class SceneConfig:
    """Top level configuration for the scene."""

    sea: SeaConfig
    island: IslandConfig

    @staticmethod
    def default() -> "SceneConfig":
        """Return a default configuration with cubic sea and one spherical island."""
        return SceneConfig(sea=SeaConfig(), island=IslandConfig())


# -----------------------------------------------------------------------------
# YAML load/save helpers
# -----------------------------------------------------------------------------

def load_config() -> SceneConfig:
    """Load the scene configuration from ``design.yaml``.

    If the configuration file does not exist, it will be created with
    default values.  Any missing fields are filled with defaults.

    Returns
    -------
    SceneConfig
        The loaded configuration.
    """
    if not CONFIG_PATH.exists():
        cfg = SceneConfig.default()
        save_config(cfg)
        return cfg

    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}

    sea_data = data.get("sea", {})
    isl_data = data.get("island", {})

    # Build sea config
    sea = SeaConfig(
        lattice_constant=float(sea_data.get("lattice_constant", 5.43)),
        supercell=list(sea_data.get("supercell", [6, 6, 6])),
    )

    # Island basic fields
    island_center = isl_data.get("center", [0.0, 0.0, 0.0])
    island_radius = float(isl_data.get("radius", 8.0))
    island_enabled = bool(isl_data.get("enabled", True))

    # Facets (list of dicts)
    facet_list: List[FacetConfig] = []
    for f in isl_data.get("facets", []):
        facet_list.append(
            FacetConfig(
                frame=f.get("frame", "sea"),
                miller=list(f.get("miller", [1, 1, 1])),
                offset=float(f.get("offset", island_radius)),
                side=f.get("side", "inside"),
            )
        )

    isl = IslandConfig(
        enabled=island_enabled,
        center=list(island_center),
        radius=island_radius,
        facets=facet_list,
    )

    return SceneConfig(sea=sea, island=isl)


def save_config(cfg: SceneConfig) -> None:
    """Save the scene configuration back to ``design.yaml``.

    Parameters
    ----------
    cfg : SceneConfig
        The configuration to save.
    """
    data: Dict[str, Any] = {
        "sea": asdict(cfg.sea),
        "island": {
            "enabled": cfg.island.enabled,
            "center": cfg.island.center,
            "radius": cfg.island.radius,
            "facets": [
                {
                    "frame": f.frame,
                    "miller": f.miller,
                    "offset": f.offset,
                    "side": f.side,
                }
                for f in cfg.island.facets
            ],
        },
    }
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, sort_keys=False)


# -----------------------------------------------------------------------------
# Geometry helper
# -----------------------------------------------------------------------------

def _compute_polyhedron_mask(
    coords: np.ndarray,
    center: np.ndarray,
    facets: List[FacetConfig],
) -> np.ndarray:
    """Return a boolean mask of coordinates that lie inside the convex polyhedron
    defined by the intersection of all facet half‑spaces.

    Parameters
    ----------
    coords : np.ndarray
        Array of shape (N, 3) with Cartesian coordinates of lattice points.
    center : np.ndarray
        3‑vector giving the island centre in the same frame as ``coords``.
    facets : list of FacetConfig
        List of facet definitions.

    Returns
    -------
    np.ndarray
        Boolean array of length N where ``True`` marks points inside the
        polyhedron.
    """
    if not facets:
        return np.zeros(len(coords), dtype=bool)

    # Translate coordinates relative to the island centre
    rel = coords - center[None, :]
    inside = np.ones(len(coords), dtype=bool)

    for facet in facets:
        h, k, l = facet.miller
        n = np.array([h, k, l], dtype=float)
        # Skip degenerate facet definitions
        if np.allclose(n, 0.0):
            continue
        n_hat = n / np.linalg.norm(n)
        # Signed distance along the normal direction
        d = rel @ n_hat
        if facet.side == "inside":
            inside &= d <= facet.offset + 1e-8
        else:
            inside &= d >= facet.offset - 1e-8
    return inside


# -----------------------------------------------------------------------------
# Atom generation
# -----------------------------------------------------------------------------

def generate_atoms(cfg: SceneConfig, max_atoms: int = 30000) -> Dict[str, Any]:
    """Generate a simple cubic lattice and carve out a convex island.

    This routine builds a simple cubic lattice of points for the host crystal
    (the sea) according to the lattice constant and supercell dimensions.  It
    then computes which atoms lie inside the island region as defined by the
    facets.  Points inside the island are flagged with ``type = 1``, while
    points outside remain ``type = 0``.  To keep the point cloud manageable
    for rendering, the list is randomly downsampled if it exceeds
    ``max_atoms`` points.

    Parameters
    ----------
    cfg : SceneConfig
        The scene configuration.
    max_atoms : int, optional
        Maximum number of atoms to include in the returned list, by default
        30000.  If there are more lattice points, a random subset will be
        chosen.

    Returns
    -------
    dict
        Dictionary containing two keys:

        ``atoms``: a list of dicts with ``x``, ``y``, ``z`` and ``type`` (0 or 1)
        for each atom.  ``type = 1`` marks island atoms.

        ``box``: bounds of the simulation cell as ``{"x": [x0,x1], "y": [...], "z": [...]}``.
    """
    a = cfg.sea.lattice_constant
    na, nb, nc = cfg.sea.supercell

    # Create a simple cubic lattice grid
    xs = np.arange(na) * a
    ys = np.arange(nb) * a
    zs = np.arange(nc) * a
    X, Y, Z = np.meshgrid(xs, ys, zs, indexing="ij")
    coords = np.stack([X.ravel(), Y.ravel(), Z.ravel()], axis=1)

    # Determine island centre: auto‑centre if all zeros
    centre_vec = np.array(cfg.island.center, dtype=float)
    if np.allclose(centre_vec, 0.0):
        centre_vec = np.array([na * a / 2.0, nb * a / 2.0, nc * a / 2.0])

    # Determine which points fall inside the island
    if cfg.island.enabled:
        if cfg.island.facets:
            inside_mask = _compute_polyhedron_mask(coords, centre_vec, cfg.island.facets)
        else:
            # Fallback: spherical island
            rel = coords - centre_vec[None, :]
            dist2 = np.sum(rel ** 2, axis=1)
            inside_mask = dist2 <= cfg.island.radius ** 2
    else:
        inside_mask = np.zeros(len(coords), dtype=bool)

    types = np.where(inside_mask, 1, 0)

    # Downsample if too many points for rendering
    n = len(coords)
    if n > max_atoms:
        idx = np.random.choice(n, size=max_atoms, replace=False)
        coords = coords[idx]
        types = types[idx]

    atoms = [
        {"x": float(x), "y": float(y), "z": float(z), "type": int(t)}
        for (x, y, z), t in zip(coords, types)
    ]

    # Bounding box for camera framing
    box = {
        "x": [0.0, float(na * a)],
        "y": [0.0, float(nb * a)],
        "z": [0.0, float(nc * a)],
    }

    return {"atoms": atoms, "box": box}
