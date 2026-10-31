/** Blocky character with animatable limb pivots + FP viewmodel */

export function makeHumanoid(THREE, primary, secondary, isPlayer) {
  const root = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color: primary, roughness: 0.7 });
  const darkMat = new THREE.MeshStandardMaterial({ color: secondary, roughness: 0.65 });
  const skinMat = new THREE.MeshStandardMaterial({
    color: isPlayer ? 0xc4a574 : 0x8a6a55,
    roughness: 0.75,
  });

  const hips = new THREE.Group();
  hips.position.y = 0.95;
  root.add(hips);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.72, 0.34), bodyMat);
  torso.position.y = 0.28;
  torso.castShadow = true;
  hips.add(torso);

  const headM = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.34), skinMat);
  headM.position.y = 0.82;
  headM.castShadow = true;
  hips.add(headM);

  const helm = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.38), darkMat);
  helm.position.y = 1.0;
  hips.add(helm);

  function makeLeg(x) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0, 0);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.24), darkMat);
    mesh.position.y = -0.3;
    mesh.castShadow = true;
    pivot.add(mesh);
    hips.add(pivot);
    return pivot;
  }
  const legL = makeLeg(-0.15);
  const legR = makeLeg(0.15);

  function makeArm(x) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.42, 0);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.58, 0.16), bodyMat);
    mesh.position.y = -0.26;
    mesh.castShadow = true;
    pivot.add(mesh);
    hips.add(pivot);
    return pivot;
  }
  const armL = makeArm(-0.42);
  const armR = makeArm(0.42);

  const rifle = new THREE.Group();
  rifle.position.set(0.02, -0.4, -0.15);
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.5, roughness: 0.35 });
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.28), darkMat);
  stock.position.set(0, 0, 0.12);
  const rec = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.48), gunMat);
  rec.position.set(0, 0.02, -0.22);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.42), new THREE.MeshStandardMaterial({ color: 0x111 }));
  bar.position.set(0, 0.04, -0.58);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.04, -0.82);
  rifle.add(stock, rec, bar, muzzle);
  armR.add(rifle);

  const viewmodel = new THREE.Group();
  const vmMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.45, roughness: 0.4 });
  const vmBody = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.65), vmMat);
  vmBody.position.set(0.35, -0.28, -0.55);
  const vmBar = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.06, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x0a0a0a })
  );
  vmBar.position.set(0.35, -0.24, -0.95);
  const vmStock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.22), darkMat);
  vmStock.position.set(0.35, -0.3, -0.22);
  const vmMuzzle = new THREE.Object3D();
  vmMuzzle.position.set(0.35, -0.24, -1.18);
  viewmodel.add(vmBody, vmBar, vmStock, vmMuzzle);
  viewmodel.visible = false;

  root.userData = {
    hips, torso, headM, legL, legR, armL, armR, rifle, muzzle, viewmodel, vmMuzzle,
    walkPhase: 0, shootKick: 0, reloadT: 0, aimBlend: 0, jumpBlend: 0,
  };

  return root;
}
