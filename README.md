# Crystal Designer

Interactive polyhedral crystal designer built with Python and JavaScript. This tool allows you to construct and visualize arbitrary polyhedral grain structures within a bulk crystal. It consists of a FastAPI backend (Python) that constructs the geometry and serves API endpoints for configuration and atom data, and a Three.js-based front-end for WYSIWYG editing and visualization.

## Features

- Define bulk crystal orientation via Miller directions, supercell size, and lattice spacing.
- Specify orientation vectors (a_dir, b_dir, c_dir) via UI for full control over host lattice orientation.
- Carve islands or inclusions in the bulk using multiple facet planes with Miller indices.
- Visualize each facet as a plane in the 3D scene; adjust plane offsets interactively.
- Add or remove facets, configure side (inside/outside) conditions.
- Built-in configuration YAML file to persist your design.
- Fast API for generating atom positions and updating configuration.
- Front-end controls for editing facets and real-time updates.

## Repository structure

```
/backend
    app.py              # FastAPI server for API endpoints (config/atoms)
    crystal_scene.py    # Scene model for sea and islands, polyhedral logic
    design.yaml         # Default configuration for the crystal and islands
    requirements.txt    # Python dependencies

/frontend
    index.html          # Main front-end page with controls and canvas
    app.js              # Front-end logic using Three.js and calls to backend
    styles.css          # Styling for the UI

```

## Usage

To get up and running, follow the installation instructions in [INSTALL.md](INSTALL.md). Once installed, start the backend server and open the front-end page.

## License

This project is released under the MIT License.
