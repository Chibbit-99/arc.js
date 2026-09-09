(async () => {
    console.log("=== ARC Minecraft Scene ===");

    const THREE = await importPackage("three");

    // Clear the page
    document.body.innerHTML = "";
    document.body.style.margin = "0";
    document.body.style.overflow = "hidden";

    // =========================
    // Scene
    // =========================

    const scene = new THREE.Scene();

    scene.background = new THREE.Color(0x87ceeb);

    // =========================
    // Camera
    // =========================

    const camera = new THREE.PerspectiveCamera(
        70,
        window.innerWidth / window.innerHeight,
        0.1,
        1000
    );

    camera.position.set(12, 10, 18);
    camera.lookAt(0, 3, 0);

    // =========================
    // Renderer
    // =========================

    const renderer = new THREE.WebGLRenderer({
        antialias: false
    });

    renderer.setSize(
        window.innerWidth,
        window.innerHeight
    );

    renderer.setPixelRatio(
        Math.min(window.devicePixelRatio, 2)
    );

    document.body.appendChild(renderer.domElement);

    // =========================
    // Lighting
    // =========================

    const ambient = new THREE.AmbientLight(
        0xffffff,
        1.5
    );

    scene.add(ambient);

    const sun = new THREE.DirectionalLight(
        0xffffff,
        3
    );

    sun.position.set(30, 50, 20);
    scene.add(sun);

    // =========================
    // Block materials
    // =========================

    const materials = {
        grass: new THREE.MeshLambertMaterial({
            color: 0x55aa33
        }),

        dirt: new THREE.MeshLambertMaterial({
            color: 0x8b5a2b
        }),

        stone: new THREE.MeshLambertMaterial({
            color: 0x888888
        }),

        wood: new THREE.MeshLambertMaterial({
            color: 0x8b5a2b
        }),

        leaves: new THREE.MeshLambertMaterial({
            color: 0x228822
        }),

        sand: new THREE.MeshLambertMaterial({
            color: 0xd8c27a
        }),

        water: new THREE.MeshLambertMaterial({
            color: 0x3399dd,
            transparent: true,
            opacity: 0.75
        })
    };

    // =========================
    // Block geometry
    // =========================

    const blockGeometry =
        new THREE.BoxGeometry(1, 1, 1);

    // =========================
    // Block helper
    // =========================

    function block(x, y, z, material) {
        const mesh = new THREE.Mesh(
            blockGeometry,
            material
        );

        mesh.position.set(x, y, z);

        scene.add(mesh);

        return mesh;
    }

    // =========================
    // Terrain
    // =========================

    const SIZE = 20;

    function terrainHeight(x, z) {
        return Math.floor(
            2 +
            Math.sin(x * 0.35) * 1.2 +
            Math.cos(z * 0.3) * 1.2 +
            Math.sin((x + z) * 0.2)
        );
    }

    for (let x = -SIZE; x <= SIZE; x++) {
        for (let z = -SIZE; z <= SIZE; z++) {

            const height = terrainHeight(x, z);

            for (let y = 0; y <= height; y++) {

                let material;

                if (y === height) {
                    material = materials.grass;
                } else if (y >= height - 2) {
                    material = materials.dirt;
                } else {
                    material = materials.stone;
                }

                block(x, y, z, material);
            }
        }
    }

    // =========================
    // Trees
    // =========================

    function tree(x, z) {

        const ground = terrainHeight(x, z);

        // trunk
        for (let y = 1; y <= 4; y++) {
            block(
                x,
                ground + y,
                z,
                materials.wood
            );
        }

        // leaves
        for (let dx = -2; dx <= 2; dx++) {
            for (let dz = -2; dz <= 2; dz++) {

                for (let dy = 3; dy <= 5; dy++) {

                    if (
                        Math.abs(dx) +
                        Math.abs(dz) +
                        Math.abs(dy - 4) <= 3
                    ) {
                        block(
                            x + dx,
                            ground + dy,
                            z + dz,
                            materials.leaves
                        );
                    }
                }
            }
        }
    }

    tree(-7, -5);
    tree(5, -8);
    tree(9, 5);
    tree(-12, 8);
    tree(2, 9);

    // =========================
    // Small lake
    // =========================

    for (let x = -5; x <= 3; x++) {
        for (let z = 5; z <= 11; z++) {

            const h = terrainHeight(x, z);

            if (h <= 3) {
                block(
                    x,
                    h + 1,
                    z,
                    materials.water
                );
            }
        }
    }

    // =========================
    // Clouds
    // =========================

    const cloudMaterial =
        new THREE.MeshBasicMaterial({
            color: 0xffffff
        });

    function cloud(x, y, z) {

        for (let i = 0; i < 5; i++) {

            const cloudBlock =
                new THREE.Mesh(
                    blockGeometry,
                    cloudMaterial
                );

            cloudBlock.position.set(
                x + i * 1.5,
                y,
                z
            );

            cloudBlock.scale.set(
                2,
                0.6,
                1.2
            );

            scene.add(cloudBlock);
        }
    }

    cloud(-15, 15, -10);
    cloud(5, 18, -5);
    cloud(-5, 20, 10);

    // =========================
    // Resize
    // =========================

    window.addEventListener("resize", () => {

        camera.aspect =
            window.innerWidth /
            window.innerHeight;

        camera.updateProjectionMatrix();

        renderer.setSize(
            window.innerWidth,
            window.innerHeight
        );
    });

    // =========================
    // Animation
    // =========================

    function animate() {

        requestAnimationFrame(animate);

        // Slightly cinematic camera movement
        const t = performance.now() * 0.00005;

        camera.position.x =
            Math.cos(t) * 25;

        camera.position.z =
            Math.sin(t) * 25;

        camera.position.y = 11;

        camera.lookAt(0, 3, 0);

        renderer.render(
            scene,
            camera
        );
    }

    animate();

    console.log("✓ Terrain generated");
    console.log("✓ Trees generated");
    console.log("✓ Water generated");
    console.log("✓ Clouds generated");
    console.log("✓ Renderer running");
    console.log("=== Minecraft scene running ===");

})();
