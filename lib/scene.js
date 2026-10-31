import { addCover } from './collision.js';

export function createWorld(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x7a92a8);
  scene.fog = new THREE.Fog(0x7a92a8, 50, 130);

  scene.add(new THREE.HemisphereLight(0xddeeff, 0x3a4028, 1.05));
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.15);
  sun.position.set(25, 40, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0x3f5a38, roughness: 0.92 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  addCover(scene, THREE, -8, -6, 3.2, 2.2, 3.2, 0x6b5b4a);
  addCover(scene, THREE, 10, -12, 4.2, 1.4, 2.4, 0x5a6a5a);
  addCover(scene, THREE, 0, -20, 5.5, 1.8, 2.2, 0x4a5560);
  addCover(scene, THREE, -14, -22, 2.5, 2.5, 2.5, 0x555045);
  addCover(scene, THREE, 14, -28, 3.5, 1.6, 3.5, 0x4d5c4d);
  addCover(scene, THREE, 2, -8, 2, 1.2, 4, 0x5c5346);

  return scene;
}
