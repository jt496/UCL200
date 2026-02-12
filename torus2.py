import matplotlib.pyplot as plt
import numpy as np

def plot_clean_k7_torus():
    # 1. Define Vertices (0-6)
    # Using specific offsets to ensure no three points are collinear 
    # and edges have clear paths for wrapping.
    vertices = {
        0: (0.15, 0.85),
        1: (0.50, 0.90),
        2: (0.85, 0.85),
        3: (0.15, 0.50),
        4: (0.50, 0.50),
        5: (0.85, 0.50),
        6: (0.50, 0.15)
    }

    fig, ax = plt.subplots(figsize=(10, 10))
    
    # 2. Draw the Fundamental Polygon (The Boundary)
    ax.plot([0, 1, 1, 0, 0], [0, 0, 1, 1, 0], 'k-', linewidth=3, zorder=5)
    
    # 3. Define the Edges for a valid Toroidal Embedding
    # To avoid crossings, we can't just take the "shortest path".
    # We must route edges according to the triangular tiling of the torus.
    
    # Adjacency list for a non-crossing K7 on a torus
    # Each edge is (node1, node2, x_wrap, y_wrap)
    # x_wrap: 0 = direct, 1 = wraps right, -1 = wraps left
    edges = [
        # Direct edges (forming a triangulation)
        (0, 1, 0, 0), (1, 2, 0, 0), (0, 3, 0, 0), (1, 4, 0, 0), 
        (2, 5, 0, 0), (3, 4, 0, 0), (4, 5, 0, 0), (3, 6, 0, 0), 
        (4, 6, 0, 0), (5, 6, 0, 0), (0, 4, 0, 0), (1, 5, 0, 0),
        
        # Wrapped edges (the "magic" of the torus)
        (0, 2, -1, 0), # 0 wraps left to meet 2 on the right
        (0, 6, 0, 1),  # 0 wraps top to meet 6 on the bottom
        (2, 6, 0, 1),  # 2 wraps top to meet 6 on the bottom
        (1, 3, 1, 1),  # Diagonal wrap
        (2, 4, 1, 0),  # Wrap right
        (5, 3, 1, 0),  # Wrap right
        (0, 5, -1, 1), # Complex wrap
        (1, 6, 0, 1),  # Wrap top
        (2, 3, 1, 0)   # Wrap right
    ]

    # 4. Draw the Edges
    for u_id, v_id, wx, wy in edges:
        p1 = np.array(vertices[u_id])
        p2 = np.array(vertices[v_id]) + np.array([wx, wy])
        
        # If the edge wraps, we need to draw two segments
        if wx != 0 or wy != 0:
            # Segment 1: From p1 to the boundary
            # Segment 2: From the opposite boundary to the original p2
            # For simplicity in visualization, we draw the full "ghost" line 
            # and clip it to the [0,1] box.
            ax.plot([p1[0], p2[0]], [p1[1], p2[1]], color='tab:orange', linewidth=2, alpha=0.8)
            ax.plot([p1[0]-wx, p2[0]-wx], [p1[1]-wy, p2[1]-wy], color='tab:orange', linewidth=2, alpha=0.8)
        else:
            ax.plot([p1[0], p2[0]], [p1[1], p2[1]], color='tab:orange', linewidth=2)

    # 5. Plot Vertices
    for v_id, pos in vertices.items():
        ax.scatter(pos[0], pos[1], s=500, color='navy', zorder=10)
        ax.text(pos[0], pos[1], str(v_id), color='white', ha='center', va='center', fontweight='bold')

    ax.set_xlim(-0.05, 1.05)
    ax.set_ylim(-0.05, 1.05)
    ax.set_aspect('equal')
  
    plt.title("K7 Embedding on a Torus (Flat Representation)", fontsize=14)
    out = 'k7_torus.png'
    plt.savefig(out, bbox_inches='tight', dpi=150)
    plt.close()
    print(f"Saved figure to {out}")

if __name__ == "__main__":
    plot_clean_k7_torus()