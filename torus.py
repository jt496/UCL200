import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

def plot_torus_embedding():
    # 1. Define the 7 vertices based on the hexagonal layout
    # We use a unit square [0,1] x [0,1]
    # Centered at (0.5, 0.5) with a "radius" of roughly 0.35
    
    # Vertices: 0 is center, 1-6 are the surrounding hexagon
    vertices = {
        0: (0.5, 0.5),      # Center
        1: (0.85, 0.5),     # Right
        2: (0.675, 0.8),    # Top-Right
        3: (0.325, 0.8),    # Top-Left
        4: (0.15, 0.5),     # Left
        5: (0.325, 0.2),    # Bottom-Left
        6: (0.675, 0.2)     # Bottom-Right
    }
    
    fig, ax = plt.subplots(figsize=(8, 8))
    
    # 2. Draw the Fundamental Polygon (The Boundary)
    ax.plot([0, 1, 1, 0, 0], [0, 0, 1, 1, 0], 'k--', linewidth=2, zorder=5)
    
    # 3. Generate Edges for K7 (All pairs connect)
    # To handle the "wrapping", we check neighbors in a 3x3 grid
    shifts = [
        (0, 0), (1, 0), (-1, 0), 
        (0, 1), (0, -1), 
        (1, 1), (1, -1), (-1, 1), (-1, -1)
    ]
    
    # Plot edges
    # We iterate through all unique pairs
    node_ids = list(vertices.keys())
    for i in range(len(node_ids)):
        for j in range(i + 1, len(node_ids)):
            u_id = node_ids[i]
            v_id = node_ids[j]
            
            u_pos = np.array(vertices[u_id])
            v_pos = np.array(vertices[v_id])
            
            # Find the shortest connection (handling wraps)
            # We look for the "ghost" of v that is closest to u
            best_dist = float('inf')
            best_segment = None
            
            for dx, dy in shifts:
                shift = np.array([dx, dy])
                candidate_v = v_pos + shift
                dist = np.linalg.norm(u_pos - candidate_v)
                
                if dist < best_dist:
                    best_dist = dist
                    best_segment = (u_pos, candidate_v)
            
            # Draw the line. 
            # Note: To make it look right when clipped, we actually draw the line 
            # and its own ghosts so they appear on all sides of the boundary.
            p1, p2 = best_segment
            for sx, sy in shifts:
                shift_vec = np.array([sx, sy])
                ax.plot([p1[0]+sx, p2[0]+sx], [p1[1]+sy, p2[1]+sy], 
                        color='orange', linewidth=1.5, alpha=0.7, zorder=1)

    # 4. Plot Vertices (Draw on top)
    # We plot ghosts too so vertices on the edge appear on both sides
    for v_id, pos in vertices.items():
        for sx, sy in shifts:
            ax.scatter(pos[0]+sx, pos[1]+sy, s=300, color='navy', zorder=10)
            # Only label the ones inside the main box to avoid clutter
            if sx == 0 and sy == 0:
                ax.text(pos[0], pos[1], str(v_id), color='white', 
                        ha='center', va='center', fontweight='bold', zorder=11)

    # 5. Set View Limits to strictly [0,1] to show the Torus representation
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.set_aspect('equal')
    ax.axis('off') # Hide axes for cleaner look
    
    plt.title("K7 Embedding on a Torus (Flat Representation)", fontsize=14)
    out = 'k7_torus.png'
    plt.savefig(out, bbox_inches='tight', dpi=150)
    plt.close()
    print(f"Saved figure to {out}")

if __name__ == "__main__":
    plot_torus_embedding()