/** Simple blocky character + rifle + animatable limbs */

export function makeHumanoid(THREE, primary, secondary, isPlayer) {
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: primary, roughness: 0.7 });
  const darkMat = new THREE.MeshStandardMaterial({ color: secondary, roughness: 0.65 });
  const skinMat = new THREE.MeshStandardMaterial({
    color: isPlayer ? 0xc4a574 : 0x8a6a55,
    roughness: 0.75,
  });

  const hips = new THREE.Group();
  hips.position.y = 0.9;
  root.add(hips);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.32), bodyMat);
  torso.position.y = 0.25;
  torso.castShadow = true;
  hips.add(torso);

  const headM = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.36, 0.32), skinMat);
  headM.position.y = 0.8;
  headM.castShadow = true;
  hips.add(headM);

  const helm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.36), darkMat);
  helm.position.y = 0.98;
  hips.add(helm);

  const legL = new THREE.Group();
  legL.position.set(-0.14, 0, 0);
  const legLMesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.55, 0.22), darkMat);
  legLMesh.position.y = -0.35;
  legLMesh.castShadow = true;
  legL.add(legLMesh);
  hips.add(legL);

  const legR = new THREE.Group();
  legR.position.set(0.14, 0, 0);
  const legRMesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.55, 0.22), darkMat);
  legRMesh.position.y = -0.35;
  legRMesh.castShadow = true;
  legR.add(legRMesh);
  hips.add(legR);

  const armL = new THREE.Group();
  armL.position.set(-0.4, 0.35, 0);
  const armLMesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.16), bodyMat);
  armLMesh.position.y = -0.25;
  armL.add(armLMesh);
  hips.add(armL);

  const armR = new THREE.Group();
  armR.position.set(0.4, 0.35, 0);
  const armRMesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.16), bodyMat);
  armRMesh.position.y = -0.25;
  armR.add(armRMesh);
  hips.add(armR);

  const rifle = new THREE.Group();
  rifle.position.set(0.05, -0.35, -0.25);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.25), darkMat);
  stock.position.set(0, 0, 0.15);
  const rec = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.14, 0.45),
    new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.4, roughness: 0.4 })
  );
  rec.position.set(0, 0.02, -0.2);
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.05, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x111 })
  );
  bar.position.set(0, 0.04, -0.55);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.04, -0.78);
  rifle.add(stock, rec, bar, muzzle);
  armR.add(rifle);

  const viewmodel = new THREE.Group();
  const vmBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.12, 0.55),
    new THREE.MeshStandardMaterial({ color: 0x222428, metalness: 0.4, roughness: 0.4 })
  );
  vmBody.position.set(0.28, -0.22, -0.5);
  const vmBar = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.05, 0.35),
    new THREE.MeshStandardMaterial({ color: 0x111113 })
  );
  vmBar.position.set(0.28, -0.18, -0.82);
  const vmMuzzle = new THREE.Object3D();
  vmMuzzle.position.set(0.28, -0.18, -1.05);
  viewmodel.add(vmBody, vmBar, vmMuzzle);
  viewmodel.visible = false;

  root.userData = {
    hips, torso, headM, legL, legR, armL, armR, rifle, muzzle, viewmodel, vmMuzzle,
    walkPhase: 0,
    shootKick: 0,
    reloadT: 0,
    aimBlend: 0,
    jumpBlend: 0,
  };
  return root;
}
