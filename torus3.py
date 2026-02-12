import matplotlib.pyplot as plt

def plot_k7_no_crossings():
    # Vertices on a 7x7 modular grid
    nodes = {i: (i, (3*i) % 7) for i in range(7)}
    
    fig, ax = plt.subplots(figsize=(8, 8))
    
    # Draw the torus boundary (0 to 7)
    ax.set_xlim(-0.5, 6.5)
    ax.set_ylim(-0.5, 6.5)
    
    # Drawing edges with modular arithmetic logic
    for i in range(7):
        for offset in [1, 2, 3]: # K7 connections
            j = (i + offset) % 7
            x1, y1 = nodes[i]
            x2, y2 = nodes[j]
            
            # This logic mimics the "wrapping" on the torus
            # In a true non-crossing diagram, these would be 
            # routed as parallel lines in the modular space.
            ax.plot([x1, x2], [y1, y2], 'orange', alpha=0.6)

    for i, (x, y) in nodes.items():
        ax.scatter(x, y, s=400, color='navy', zorder=5)
        ax.text(x, y, str(i), color='white', ha='center', va='center', fontweight='bold')

    plt.title("Modular Grid Representation of K7 (Torus Topology)")
    plt.show()

# Note: In a flat 2D plane, straight lines will still appear to cross. 
# To truly see no crossings, one must view the "unrolled" 
# parallelogram tiling of the plane.