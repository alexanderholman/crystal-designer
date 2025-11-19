from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any
import uvicorn

"""
app.py
======

This file exposes a simple REST API using FastAPI for configuring and
visualising the crystal scene.  It provides endpoints to retrieve and
update the YAML configuration as well as to generate a downsampled list of
atoms for visualisation.  Cross‑origin requests are allowed to simplify
development of a front‑end in a separate origin (such as an html file on
``file://`` or localhost).

Endpoints
---------

``GET /api/config``
    Return the current configuration as JSON.
``POST /api/config``
    Update the configuration.  The entire structure must be provided.
``GET /api/atoms``
    Return a downsampled set of atom coordinates and box bounds for
    visualisation.
"""

from .crystal_scene import (
    SceneConfig,
    SeaConfig,
    IslandConfig,
    FacetConfig,
    load_config,
    save_config,
    generate_atoms,
)


class SeaModel(BaseModel):
    lattice_constant: float
    supercell: List[int]


class FacetModel(BaseModel):
    frame: str = "sea"
    miller: List[int] = [1, 1, 1]
    offset: float = 8.0
    side: str = "inside"


class IslandModel(BaseModel):
    enabled: bool
    center: List[float]
    radius: float
    facets: List[FacetModel] = []


class SceneModel(BaseModel):
    sea: SeaModel
    island: IslandModel


app = FastAPI()

# Allow requests from any origin (development convenience)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/config", response_model=SceneModel)
def get_config() -> SceneModel:
    """Return the current scene configuration."""
    cfg = load_config()
    return SceneModel(
        sea=SeaModel(
            lattice_constant=cfg.sea.lattice_constant,
            supercell=cfg.sea.supercell,
        ),
        island=IslandModel(
            enabled=cfg.island.enabled,
            center=cfg.island.center,
            radius=cfg.island.radius,
            facets=[
                FacetModel(
                    frame=f.frame,
                    miller=f.miller,
                    offset=f.offset,
                    side=f.side,
                )
                for f in cfg.island.facets
            ],
        ),
    )


@app.post("/api/config", response_model=SceneModel)
def set_config(scene: SceneModel) -> SceneModel:
    """Update the scene configuration."""
    facets = [
        FacetConfig(
            frame=f.frame,
            miller=list(f.miller),
            offset=f.offset,
            side=f.side,
        )
        for f in scene.island.facets
    ]
    cfg = SceneConfig(
        sea=SeaConfig(
            lattice_constant=scene.sea.lattice_constant,
            supercell=scene.sea.supercell,
        ),
        island=IslandConfig(
            enabled=scene.island.enabled,
            center=scene.island.center,
            radius=scene.island.radius,
            facets=facets,
        ),
    )
    save_config(cfg)
    return scene


@app.get("/api/atoms")
def get_atoms(max_atoms: int = 20000) -> Dict[str, Any]:
    """Return a downsampled list of atoms and box bounds for visualisation."""
    cfg = load_config()
    data = generate_atoms(cfg, max_atoms=max_atoms)
    return data


if __name__ == "__main__":
    # Run the development server if this file is executed directly
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)